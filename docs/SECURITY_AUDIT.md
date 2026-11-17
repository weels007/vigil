# Vigil — security audit

**Scope:** `contracts/vigil.py`, the app's write path (`src/lib/*`), and the Studionet driver
(`scripts/studionet-run.mjs`). Date: 17 November 2026.

Vigil has a deliberately small surface: one URL, one condition, one beneficiary, one deadline, and
one non-deterministic method. Threats that belong to other GenLayer designs (rolling precedent,
oracle challenges, arbitration escrow, fee oracles, prediction markets) have no state to attack here.

## Findings and fixes

| # | Severity | Finding | Fix | Test |
| --- | --- | --- | --- | --- |
| 1 | High | A check could settle after the deadline. A beneficiary could start it just before the deadline and take the deposit ahead of the creator's refund; checks were only gated on `ACTIVE`. | `check_vault` rejects at or after the deadline, and re-reads the wall clock after consensus, so a check that finishes late reverts even if it started early. | `test_check_at_the_deadline_is_rejected`, `test_check_after_the_deadline_is_rejected`, `test_consensus_cannot_settle_after_the_deadline` |
| 2 | High | The accepted consensus value was trusted with `str()`/`bool()` coercion: an unknown label, a non-boolean `met`, or `met=true` with a low confidence could settle. The 60-confidence floor lived only in the leader's parser. | `_normalise_consensus` requires a known outcome, boolean `met`/`injection`, an integer 0–100 confidence, and consistent label/flag combinations; malformed or inconsistent results become `UNVERIFIABLE`, and `MET` below 60 becomes `NOT_MET`. | `test_consensus_*` (8 tests) |
| 3 | Medium | Two overlapping checks could both pass the pre-flight gate; the later one wrote `checks + 1` from its stale read, overwriting the attempt count and resetting the cooldown. | After consensus the vault is re-read; the cooldown, cap and attempt counter use that fresh state. | `test_settlement_cannot_happen_twice` (existing) plus the fresh-state logic |
| 4 | Medium | A vault could point the validator fleet at `localhost`, loopback, link-local or private-network IPv4 literals (SSRF against the GenVM web gateway). | `create_vault` extracts the host and refuses loopback, private IPv4 literals and `.localhost` / `.local` / `.internal` suffixes. | 7 URL guard tests including `169.254.169.254` and `172.20/12` |
| 5 | Low | The `<title>` was stripped with the rest of `<head>`, so an announcement that lived only in the title was invisible to the judge. | `_html_to_text` extracts the title before stripping `<head>` and prepends it to the fenced evidence. | `test_page_title_is_supplied_as_evidence` (the LLM mock only matches if the title reached the prompt) |
| 6 | Low | A zero-address beneficiary burned the deposit with no recovery path. | `create_vault` rejects the zero address. | `test_zero_beneficiary_is_rejected` |
| 7 | Low | The vault detail page locked each action separately, so Check and Cancel could be submitted together. On-chain guards made that safe, but it produced a confusing second revert. | One in-flight lock disables every action on the vault, and the Create form ignores a second submit. | Manual / build check |
| 8 | Info | `reason` is stored but not compared, and is not used by any later decision. This is intentional: free text is display-only, so a malicious leader cannot steer a future payout with it. | No change; enforced by the fact that settlement reads only normalised `outcome`, `met`, `injection`. | `test_validator_ignores_the_free_text_reason` |

## Feedback from other contracts: does it apply?

| Feedback theme | Applies to Vigil? | Why |
| --- | --- | --- |
| Rolling precedent / reason for departing from precedent | No | Vigil has no precedent history or reason-check prompt. |
| Validators must bind every persisted field used later | Yes, in principle | Only `outcome`, `met`, `injection` can move money; they are normalised after consensus. `reason` is display-only and never read back. |
| Different raw readings change a later statistical baseline | No | No statistical state is persisted; each check is independent. |
| Oracle challenge expiry / escrow locked forever | No | No challenge or escrow. The creator can cancel at any time, and after the deadline anyone can refund. |
| Arbitration timeout / unilateral recovery | No | No arbitration state. |
| Bind source claims to fetched URLs | Already done | The contract fetches the URL itself inside the non-deterministic block; callers supply no evidence. |
| Fetched submission discarded | Already done | The fetched body (including the title) is fenced and passed to the judge. |
| Fee/performance fields unverified but reused | No | No fee or performance-analysis state. |
| Owner-supplied market text | No | The only text is the creator's condition; evidence is fetched contract-side. |
| Claimant snapshot + hash | No | No snapshots or hashes are accepted. |
| Stored reasoning reused in appeal | No | There is no appeal and `reason` is never reused. |
| Partial settlement percentage | No | One amount, one beneficiary, no partial payout. |
| Float division | No | The contract performs no division. |
| Re-pin the GenLayer dependency | Already done | The runner hash is pinned exactly and `genlayer-test==0.29.2`. |
| Forge receipt correlation | No forge here | The app waits on the transaction hash returned by `writeContract`; the driver polls that hash. |
| Prediction page bet aggregation | No | No prediction market. |
| Fund-conservation tests | Already present | `test_money.py` asserts credits, totals and `total_locked` across settle, cancel and refund; `test_settlement_cannot_happen_twice` covers double settlement. |

## Residual risks (accepted)

1. **Check-cap griefing.** Any caller may spend the 12-check budget over 12 hours (one per hour, each
   paid by the caller). After the deadline the refund still works; before it, a true condition could
   go unchecked. This is bounded by the spec's cap and by transaction fees.
2. **Creator cancel right.** The creator can cancel before any successful check. This is the stated
   product rule, but it means a beneficiary has no guarantee until a check settles.
3. **DNS rebinding.** The host guard stops literal private hosts. A public name that later resolves
   to a private address is outside the contract; the GenVM web gateway must enforce the network
   boundary.
4. **Evidence drift and LLM subjectivity.** Validators fetch independently; a changing page yields an
   undetermined transaction. Two honest judges can disagree on edge cases, and the vault stays
   `ACTIVE`.
5. **No mainnet audit.** Studionet only.

## How this is verified

- Direct mode: 158 tests, no Docker and no network, covering every method, creation guards, the
  settle / no-settle / unverifiable / injection paths, cooldowns, credit accounting, double
  settlement, validator agreement, structural lint, malformed consensus payloads and hostile pages.
- CI: `.github/workflows/ci.yml` runs pytest and `npm run build`.
- Live: `.github/workflows/studionet.yml` with `[adjudication]` deploys to Studionet, drives the
  lifecycle with two funded wallets, runs two real LLM checks, prints a result table and records the
  contract address.
