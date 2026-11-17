# Vigil — submission

**One line:** Vigil locks GEN in conditional vaults that unlock when a plain-English condition on a
public web page becomes true, judged by an LLM and verified by GenLayer validators.

Contract (Studionet): [0x0Ae4F21efC452642dE258711aC9739dde4C5b1fC](https://explorer-studio.genlayer.com/address/0x0Ae4F21efC452642dE258711aC9739dde4C5b1fC)

## The problem

Programmable money is good at binary facts that live on chain. It is bad at the facts that people
actually argue about: whether a project shipped, whether a page still lists a role, whether an
announcement exists. Today those conditions need an oracle, a multisig, or a middleman.

Vigil makes the page itself the evidence and makes judgement the contract's job, without letting the
judgement move money on its own.

## How it uses GenLayer

`check_vault(id)` is the only method with a non-deterministic block:

1. **The contract fetches the page itself** (`gl.nondet.web.get`) — no external keeper supplies the
   evidence.
2. **An LLM returns a structured decision** with `met`, `unverifiable`, `injection_suspected`,
   `confidence` and a short reason. The page is fenced as untrusted data.
3. **Validators independently re-run the task** and must match exactly on `outcome`, `met`, the
   injection flag and a coarse confidence bucket. The free-text reason is never compared.
4. **Deterministic code moves the money**: on `MET`, the beneficiary is credited and the vault becomes
   `TRIGGERED`. `NOT_MET`, `UNVERIFIABLE` and `INJECTION` change nothing but the check log.

Unreadable pages, malformed adjudicator output and pages that try to instruct the judge all fail
closed. A flagged check can never settle a vault. `met` below 60 confidence does not settle either.

## What a user can do

- Open a vault: title, plain-English condition, one public host, beneficiary, deadline, deposit.
- Check it: anyone, once per hour, up to 12 times, and only before the deadline.
- Cancel: the creator, while the vault is active.
- Refund: anyone, after the deadline, back to the creator.
- Withdraw: each address pulls the credit Vigil recorded for it. Payouts are pull payments.

## Contract surface

`create_vault`, `check_vault`, `cancel_vault`, `refund_vault`, `withdraw`,
`get_owner`, `get_vault_count`, `get_vault_json`, `get_vaults_json`, `get_credit_of`, `get_totals`.

States: `ACTIVE`, `TRIGGERED`, `CANCELLED`, `REFUNDED`.

## The app

Vite + React + TypeScript with hash routing: landing, vault register, vault detail (condition,
countdown, check log, decision reason, evidence link), create form, and a lifecycle ledger. Reads come
from the contract through `genlayer-js` at `LATEST_NONFINAL`; writes sign through `window.ethereum`
with the Studionet network offered at connect time. Every action is locked while in flight, and
contract reverts are translated into readable sentences.

The interface is a night watch: midnight blue, moonlight text, one warm amber accent for actions and
for "unlocked", a lantern/eye mark, and a ledger-like serif and monospaced typography. No template
dashboard, no mock data.

## Live verification

The `[adjudication]` workflow run of 17 Nov 2026 deployed the contract with two funded test wallets
and asserted the result on chain after every step: cancel and withdraw, a deadline refund, the
self-pay guard, a live `check_vault` that returned `MET` and settled to the beneficiary (who then
withdrew the credit), and a live check on a condition the page does not meet that left its vault
`ACTIVE`.

Full result table: [Studionet run 44017515027](https://github.com/weels007/vigil/actions/runs/44017515027).

## Proof

- `contracts/vigil.py` — the Intelligent Contract, runner hash pinned.
- `tests/` — pytest direct mode: registry, creation guards, settle / no-settle / unverifiable /
  injection, cancel, refund, cooldown, credit accounting, double settlement, validator agreement,
  structural lint, adversarial inputs.
- `.github/workflows/ci.yml` — pytest plus `npm run build`.
- `.github/workflows/studionet.yml` — deploys with the project's two test wallets, drives the real
  lifecycle (create, cancel, withdraw, refund after deadline, guard probe, and an opt-in live LLM
  adjudication that settles a true condition and leaves a false one `ACTIVE`), prints a result table,
  and records the address back into the repository.

## Links

- Contract: see the address at the top, or `Live contract` in `README.md`.
- Live app: [vigil-alpha-eight.vercel.app](https://vigil-alpha-eight.vercel.app)
- App deployment guide: `docs/VERCEL_DEPLOY.md`.
- Repository: [github.com/weels007/vigil](https://github.com/weels007/vigil)
- Architecture: `docs/ARCHITECTURE.md`.
- Security audit: `docs/SECURITY_AUDIT.md`.
- Deployment: `DEPLOY.md`.
