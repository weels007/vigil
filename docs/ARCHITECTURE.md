# Vigil — architecture

## 1. Layers

```
          browser                                       GenLayer
┌──────────────────────────┐            ┌────────────────────────────────────┐
│ Vite + React (hash routes)│   RPC      │ Vigil (Intelligent Contract)       │
│ genlayer-js read client   │◀──────────▶│  views: JSON cards, totals, credit │
│ genlayer-js write client  │            │  writes: deterministic money       │
│ window.ethereum signing   │            │  one nondet block: read + judge    │
└──────────────────────────┘            └────────────────────────────────────┘
```

There is no backend and no database. The app renders only what the contract returns; the contract
address is compiled into the bundle.

## 2. Storage

`Vigil` keeps all state in sized primitives and two `TreeMap`s. `Vault` is a flat
`@allow_storage` dataclass — no nested collections, no dicts, no lists:

| Field | Type | Meaning |
| --- | --- | --- |
| `vault_id` | `u256` | id, also the map key |
| `creator`, `beneficiary` | `Address` | parties |
| `title`, `condition`, `url` | `str` | the terms |
| `deadline` | `u256` | unix seconds |
| `amount` | `u256` | locked wei |
| `state` | `str` | `ACTIVE` / `TRIGGERED` / `CANCELLED` / `REFUNDED` |
| `checks` | `u32` | attempts, capped at 12 |
| `created_at`, `last_check_at`, `resolved_at` | `u256` | ledger timestamps |
| `last_outcome`, `last_reason` | `str` | check log |
| `last_met`, `last_injection` | `bool` | check log |

Global maps: `vaults: TreeMap[u256, Vault]`, `credits: TreeMap[Address, u256]`.
Global counters: `vault_count`, `total_locked`, `total_settled`, `total_refunded`,
`total_cancelled`, `total_withdrawn`, `total_checks`.

TreeMap reads always pass a default: `self.credits.get(addr, u256(0))`. A one-argument `.get` breaks
on the node, and `tests/test_lint.py` fails if one appears.

## 3. State machine

```
                      ┌──────────────────────────────┐
                      │            ACTIVE            │
                      │  check · cancel · refund*    │
                      └──────────────┬───────────────┘
                                     │
        ┌────────────────────────────┼───────────────────────────┐
        │ check: MET (before deadline)│ cancel (creator)         │ refund* (anyone)
        ▼                            ▼                           ▼
  ┌────────────┐              ┌─────────────┐            ┌─────────────┐
  │ TRIGGERED  │              │  CANCELLED  │            │  REFUNDED   │
  │ credit→payee│              │ credit→creator│          │ credit→creator│
  └────────────┘              └─────────────┘            └─────────────┘

  * only when now >= deadline
  check is only allowed while now < deadline
  NOT_MET / UNVERIFIABLE / INJECTION keep the vault ACTIVE and write the check log.
```

Every terminal transition credits an address and decrements `total_locked` exactly once. A vault in
a terminal state rejects `check_vault`, `cancel_vault` and `refund_vault`, which is what makes double
settlement impossible even without a reentrancy guard. After the deadline a check is rejected, so the
beneficiary cannot take the deposit ahead of the creator's refund.

## 4. Deterministic vs non-deterministic

`check_vault` is the only method with a nondeterministic block.

**Deterministic, before the block**

- vault exists, state is `ACTIVE`, `now < deadline`, `checks < 12`;
- cooldown: `now >= last_check_at + 3600` when at least one check happened;
- copy `title`, `condition`, `url` into plain locals — no storage reads inside the block.

**Inside `leader_fn`**

- `gl.nondet.web.get(url)`, status and body read defensively (`status_code` / `status` / `code`,
  `body` / `content` / `text`);
- HTML reduced to text, capped at 12,000 characters, fence markers stripped;
- one `gl.nondet.exec_prompt(..., response_format="json")`;
- parse to a decision; any failure becomes `UNVERIFIABLE`, never an exception that could be confused
  with a settlement.

**Inside `validator_fn`**

- rejects a non-`Return` leader result;
- re-runs `leader_fn` independently (its own web fetch and LLM call);
- agrees only when `outcome`, `met`, `injection` and the confidence bucket all match. `reason` is not
  compared.

**Deterministic, after the block**

- re-read the vault, re-check `ACTIVE` and re-read the wall clock; a check that finishes at or after
  the deadline reverts, even if it started before it, so it can never take the creator's refund;
- re-read `checks` and `last_check_at`: if another check landed while this one was being decided,
  the cooldown and the 12-check cap are enforced against that fresh state;
- normalise the consensus payload: `outcome` must be one of the four labels, `met` and `injection`
  must be booleans, `confidence` must be an integer in 0–100, and `MET`/`NOT_MET`/`INJECTION` must
  agree with the flags; anything else becomes `UNVERIFIABLE` before it is stored, and a `MET` below
  the 60 confidence floor becomes `NOT_MET`;
- increment `checks`, stamp `last_check_at` with the post-consensus clock, store outcome/reason/flags;
- if and only if the normalised `outcome == MET and met and not injection`: set `TRIGGERED`, credit
  the beneficiary, move totals.

`gl.vm.run_nondet` returns the accepted leader value. The contract accepts either the value or a
`Return`-shaped wrapper, so it is robust to the SDK surface.

## 5. Consensus strategy

| Field | Comparison | Why |
| --- | --- | --- |
| `outcome` | exact | collapses the decision into four safe labels |
| `met` | exact | the settlement condition |
| `injection` | exact | a flagged check must never settle |
| `bucket` | exact, 0–3 from confidence | coarse enough for two LLMs, strict enough to matter |
| `reason` | not compared | free text always differs |

Independent re-execution (not a schema check) is what makes this consensus rather than a leader
rubber stamp. A validator that only checked JSON shape would let a malicious leader settle any vault.

## 6. Security

**Prompt injection.** The evidence is fenced between `<<<VIGIL_EVIDENCE_START>>>` and
`<<<VIGIL_EVIDENCE_END>>>`; those markers are stripped from the page before fencing, so a page cannot
close the fence. The prompt says the block is data, never instructions, and the output carries
`injection_suspected`. If it is true, the contract forces `INJECTION`, stores the flag, and never
credits — even if the model also returned `met: true`.

**Confidence floor.** `met` with confidence below 60 becomes `NOT_MET`, so a hesitant model cannot
move money.

**Unverifiable evidence.** 4xx/5xx, empty or unreadable pages, an unreachable adjudicator, or an
adjudicator answer that is prose, malformed JSON, a JSON array, or has non-boolean decision fields all
produce `UNVERIFIABLE`. The vault stays `ACTIVE` and is logged as such.

**Pull payments.** The contract credits; it does not push. `withdraw` is the only place that emits an
external GEN transfer, and it zeroes the credit before emitting. A failed transfer reverts the whole
transaction, so the credit is restored.

**No value entry point.** There is no `__receive__`, so a bare transfer to the contract is rejected by
GenVM rather than silently stranded. No public dunder name exists; the schema generator rejects them.

**Public hosts only.** `create_vault` extracts the host from the URL and refuses `localhost`, the
`[::1]` loopback, private IPv4 literals (`10/8`, `127/8`, `172.16/12`, `192.168/16`, `169.254/16`,
`0/8`) and `.localhost` / `.local` / `.internal` suffixes. This blocks the obvious server-side
request-forgery targets. A public name that later resolves to a private address (DNS rebinding) is
outside the contract and must be handled by the GenVM web gateway.

**Bound consensus output.** `reason` is descriptive only and is never compared. Every field that can
move money (`outcome`, `met`, `injection`) is checked again by deterministic code after
`run_nondet`: wrong types, an unknown label or an inconsistent combination become `UNVERIFIABLE`
and cannot settle. A malformed consensus result never becomes a payout.

**Title as evidence.** The page `<title>` is extracted before `<head>` is stripped, so an
announcement that lives only in the title is still part of the fenced evidence.

**Bounded abuse.** One check per hour per vault and at most 12 checks bound the LLM cost any single
vault can impose. Checks are paid by the caller's transaction fee; vault money is untouched.

**Deadline cutoff.** `check_vault` is rejected at or after the deadline, and its result is rejected
again after consensus if the clock has crossed the deadline while validators were deciding. A
beneficiary therefore cannot front-run the creator's refund with a late settlement.

**Concurrent checks.** The vault is re-read after consensus. If a second check was committed while
this one was deciding, the cooldown and the check cap are applied to the fresh state and the attempt
counter is incremented from it, so overlapping transactions cannot overwrite the log or settle twice.

**Deterministic settlement only.** No storage write, message emission or contract call happens inside
the nondet block. `tests/test_lint.py` enforces that `gl.nondet` appears only inside `leader_fn`, that
`leader_fn` contains no `self.`, and that `emit_transfer` appears once, inside `_send_gen`.

## 7. Invariants

1. `total_locked == Σ amount of ACTIVE vaults`.
2. `total_settled` only grows on `TRIGGERED`, `total_cancelled` on `CANCELLED`, `total_refunded` on
   `REFUNDED`; each grows by exactly the vault amount.
3. A vault leaves `ACTIVE` at most once.
4. `credits[a]` is the sum of every terminal credit to `a` minus every withdrawal by `a`.
5. A vault can only be `TRIGGERED` by a check made before the deadline whose normalised
   `outcome == MET`, `met == true` and `injection == false`, and whose validators agreed.
6. `withdraw` sends exactly the credit it clears.

The direct-mode tests assert each invariant through the public views, including a full lifecycle that
settles, cancels and refunds in one contract instance.

## 8. Limits

- **Evidence drift.** Validators fetch independently; a page that changes between fetches can produce
  an undetermined transaction. That is the safe failure: nothing settles.
- **No archival proof.** The contract stores the decision and reason, not the page snapshot. A vault's
  history is only as rich as its check log.
- **LLM subjectivity.** The confidence bucket and exact `met` comparison bound it, but two honest
  models can disagree on edge cases; the vault stays `ACTIVE`.
- **Literal judges.** In the first live `[adjudication]` run the judge read a condition that asked
  for an exact phrase strictly and returned `NOT_MET`, so the vault stayed `ACTIVE` with no credit.
  That is the intended fail-closed behaviour: a missed settlement is recoverable, a wrong one is not.
- **One URL.** A condition that needs several sources must be written to work from one page.
- **No partial settlement.** One condition, one amount, one beneficiary.
- **Studionet only.** No audit, no mainnet deployment; validator behaviour and fees differ on a
  production network.
