# Vigil

**Conditional vaults that unlock when a plain-English condition on a public web page becomes true.**

Vigil locks GEN against one sentence and one URL. Anyone may ask the contract to read the page.
An LLM decides whether the condition is clearly satisfied, GenLayer validators independently re-run
the same task, and money only moves when deterministic code sees agreement. If the page is missing,
unreadable, or tries to manipulate the judge, the vault stays locked.

Live contract: `0xe5f0604D72C36e4623971599E6C33816D7E973DF` on GenLayer Studionet — [explorer](https://explorer-studio.genlayer.com/address/0xe5f0604D72C36e4623971599E6C33816D7E973DF)

## The shape of a vault

A creator locks GEN with:

- a **title** (max 80 characters),
- a **condition** in plain English (max 500 characters),
- one **public http(s) URL** that the condition is about (max 300 characters),
- a **beneficiary** address that receives the money when the condition is met,
- a **deadline** (unix seconds). After it, the deposit can go home.

The creator can cancel before any successful check. Checks are only accepted before the deadline; once
it passes, anyone may trigger the refund to the creator. The beneficiary (or the creator, after a
cancel or refund) pulls their credit with `withdraw()` — Vigil never pushes funds.

```
ACTIVE ── check: met ─────────────▶ TRIGGERED   (credit → beneficiary)
   │
   ├── creator cancels ───────────▶ CANCELLED   (credit → creator)
   │
   └── deadline passes, refund ───▶ REFUNDED    (credit → creator)

ACTIVE also survives NOT_MET, UNVERIFIABLE and INJECTION checks: nothing moves, the log records why,
and the vault can be checked again later.
```

## Why it needs GenLayer

A normal smart contract cannot read a web page and cannot judge a sentence. An oracle would ask you
to trust one key. Vigil uses an Intelligent Contract instead:

1. `check_vault(id)` fetches the URL **inside the contract**, strips markup, and fences the evidence.
2. One LLM call returns `{ met, unverifiable, injection_suspected, confidence, reason }`.
3. Validators re-run the whole task and must match exactly on `outcome`, `met` and the injection
   flag, and on a coarse confidence bucket. The free-text reason is stored but never compared.
4. Only after agreement does deterministic code credit the beneficiary and flip the state.

A `UNVERIFIABLE` or `INJECTION` result never settles. Neither does `met` below 60 confidence.

## Verified on Studionet

The `[adjudication]` run of 17 Nov 2026 deployed this contract and drove the whole lifecycle with
two funded wallets, reading the state back after every step:

- `create_vault` → `cancel_vault` → `withdraw`: the creator was credited 0.01 GEN and pulled it.
- A vault with a 75-second deadline was `REFUNDED` after it passed, crediting the creator.
- The self-pay guard rejected a vault whose beneficiary was its creator (vault count unchanged).
- A live `check_vault` on `example.com` reading "The page contains the word 'domain'" returned
  `MET`, the vault became `TRIGGERED`, the beneficiary was credited 0.01 GEN and then withdrew it.
- A second live check on a condition the page does not meet stayed `ACTIVE` with no credit.
- `get_totals` reported the expected ledger after each move.

The workflow's step summary carries the full table; `studionet-run.json` is uploaded as an artifact.
The first live attempt also proved the fail-closed rule: a judge read an exact-phrase condition
strictly, returned `NOT_MET`, and nothing moved.

## Contract surface

| Method | Kind | What it does |
| --- | --- | --- |
| `create_vault(beneficiary, title, condition, url, deadline)` | payable write | Opens a vault, returns its id |
| `check_vault(vault_id)` | write + nondet | Reads the page, adjudicates, settles on agreement |
| `cancel_vault(vault_id)` | write | Creator only, while ACTIVE |
| `refund_vault(vault_id)` | write | Anyone, after the deadline |
| `withdraw()` | write | Pulls the caller's credit as an external transfer |
| `get_owner()` | view | Deployer address |
| `get_vault_count()` | view | Number of vaults ever opened |
| `get_vault_json(id)` | view | One JSON card for the detail page |
| `get_vaults_json(offset, limit)` | view | Newest-first page of vault cards |
| `get_credit_of(address)` | view | Pullable credit |
| `get_totals()` | view | Contract totals and balance |

Guards: field caps, http/https with a public host (no localhost or private IP literals), beneficiary
≠ creator and ≠ the zero address, deposit > 0, future deadline, one check per hour per vault, at most
12 checks per vault, checks only before the deadline, no `__receive__` handler.

## The app

Vite + React + TypeScript, hash routing, no mock data. Everything is read from the contract through
`genlayer-js` with `transactionHashVariant: LATEST_NONFINAL`.

- `#/` — landing, live totals, recently opened vaults
- `#/vaults` — the register, with state filters and search
- `#/vaults/:id` — condition, deadline countdown, check log, reason, evidence link, actions
- `#/create` — open a vault, with the contract's guards mirrored in the form
- `#/activity` — lifecycle ledger and the connected wallet's credit

Writes use `window.ethereum`, offer the Studionet switch (`chainId 61999`, `0xf22f`), lock each
action while it is in flight, and translate contract reverts into readable sentences.

The contract address is hard-set in `src/lib/genlayer.ts` (`CONTRACT_ADDRESS`), never an env var.

## Develop

```bash
npm install
npm run dev
```

## Test

Direct mode: no Docker, no network, contract executed in-process.

```bash
pip install -r requirements.txt

# genlayer-test 0.29.2 ignores GENVM_VERSION and resolves GitHub's newest GenVM
# release, which no longer ships genvm-universal.tar.xz. Seed its cache with the
# bundle the contract header targets, then run:
mkdir -p ~/.cache/gltest-direct
curl -L -o ~/.cache/gltest-direct/genvm-universal-v0.2.16.tar.xz \
  https://github.com/genlayerlabs/genvm/releases/download/v0.2.16/genvm-universal.tar.xz

GENVM_VERSION=v0.2.16 pytest -q
```

The suite covers the registry and creation guards, the settle / no-settle / unverifiable / injection
paths, cancel, refund, cooldown, credit accounting, double settlement, validator agreement, a
structural lint of the contract source, and an adversarial file for malformed adjudicator output and
hostile pages. The runner bundle is downloaded once, at session start; the tests themselves perform
no network calls.

## Deploy

See [DEPLOY.md](DEPLOY.md). The short version: push to `main` with `[deploy]` in the commit message
(or run the **Studionet** workflow manually), and the workflow deploys with the project's test
wallets, drives the lifecycle, prints a result table, and records the address back into this README,
`SUBMISSION.md` and `src/lib/genlayer.ts`. Push with `[adjudication]` instead to also run two real
LLM checks against `example.com`: a true condition that must settle and a false one that must not.

## Layout

```
contracts/vigil.py        the Intelligent Contract
tests/                    pytest direct-mode suite (contract, lint, adversarial)
src/                      Vite + React app
scripts/studionet-run.mjs deploy + lifecycle driver
scripts/record-address.mjs writes the address into the app and docs
docs/ARCHITECTURE.md      state machine, consensus, invariants, limits
docs/SECURITY_AUDIT.md    audit findings, fixes and feedback mapping
```

## Security review

- **Evidence, not claim.** The contract fetches the URL itself and validators re-fetch it; no caller
  supplies the evidence. The page title is kept, script/style/head noise is stripped, and the
  evidence is fenced and capped.
- **Only agreed fields move money.** Validators compare `outcome`, `met`, the injection flag and a
  confidence bucket. `reason` is descriptive and is never used by settlement or by any later
  decision.
- **Bound after consensus.** Deterministic code re-checks the accepted label, boolean flags and
  confidence, and applies the 60-confidence floor again; a malformed or inconsistent consensus
  result becomes `UNVERIFIABLE`.
- **Deadline cutoff.** A check is only accepted before the deadline, and is rejected again after
  consensus if the clock crossed it. The beneficiary cannot front-run the creator's refund.
- **Caller limits.** Only the creator can cancel. Refunds are permissionless but always pay the
  creator. `withdraw` only ever pays the caller's own credit. There is no `__receive__` handler.
- **Overlapping checks.** A second check that lands while one is being decided is re-read from
  storage; the cooldown and the 12-check cap are enforced against the fresh state.
- **Public hosts only.** Localhost, private IPv4 literals and `.local` / `.internal` suffixes are
  refused at creation. A public name that later resolves to a private address is left to the GenVM
  web gateway.
- **Pull payments.** The credit is zeroed before the external transfer; a failed transfer reverts the
  transaction and restores the credit.

## Limits, stated plainly

- The evidence is whatever the page serves at check time, to each validator independently. A page
  that changes between reads produces disagreement, and an undetermined transaction — never a guess.
- The LLM is a judge, not an oracle. Vigil contains that judgement with a confidence floor, an
  injection flag that blocks settlement, and a two-outcome agreement rule.
- A check costs a transaction fee, not vault money. The cooldown and the 12-check cap bound abuse.
- Checks stop at the deadline. A check that would settle after it is rejected, so the beneficiary
  cannot race the creator's refund.
- A private-network or loopback URL is refused at creation. DNS that later resolves to a private
  address is outside the contract's control and is left to the GenVM web gateway.
- Vigil is deployed on Studionet, GenLayer's development network. It is not audited for mainnet.
