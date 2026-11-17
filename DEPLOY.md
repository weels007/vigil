# Deploying Vigil

Vigil is an Intelligent Contract on GenLayer **Studionet** plus a static Vite app. The app has no
server: it talks to `https://studio.genlayer.com/api` and signs with the browser wallet.

## 1. What you need

- Node 20+ and npm (for the app and the deployment script).
- A GenLayer wallet with GEN on Studionet. The Studio account selector has a built-in faucet.
- Two wallets for the automated run: a **creator** and a **beneficiary**. Their addresses must differ,
  because the contract rejects a vault whose beneficiary is its creator.

## 2. Record the address

`src/lib/genlayer.ts` holds the address in one line:

```ts
export const CONTRACT_ADDRESS = '0x...';
```

This is deliberate: the address is part of the deployed product, not an environment variable. After
a deployment, record it everywhere with:

```bash
node scripts/record-address.mjs 0xYourContractAddress
```

That rewrites the constant, the `Live contract:` line in `README.md`, and the
`Contract (Studionet):` line in `SUBMISSION.md`.

## 3. The Studionet workflow

`.github/workflows/studionet.yml` deploys and drives the real lifecycle.

It runs when:

- you push to `main` **and** the commit message contains `[deploy]` or `[adjudication]`, or
- you start **Studionet → Run workflow** manually. Tick `adjudication` to include the slow, real LLM
  check.

`[adjudication]` does everything `[deploy]` does and also runs two real `check_vault` calls against
`example.com`: one condition the page plainly satisfies (it must settle), and one it plainly does not
(it must stay `ACTIVE`).

### Wallets and secrets

The runner resolves each test wallet in this order:

1. `VIGIL_TESTER1_PRIVATE_KEY` / `VIGIL_TESTER2_PRIVATE_KEY`
2. `VIGIL_TESTER1_KEYSTORE` + `VIGIL_TESTER1_PASSWORD` (keystore JSON inline, or a path to a file)
3. `../wallet/<NAME>.json` beside this repository, with `<NAME>.password` (or `.txt`) next to it,
   where `<NAME>` is `VIGIL_TESTER1_KEYSTORE` or `VIGIL_TESTER2_KEYSTORE`
4. an ephemeral key generated for the run, funded from Studio's built-in faucet
   (`sim_fundAccount`) when the run starts

Add the two keystore/password pairs as repository secrets with exactly those names. The fourth
fallback is what makes the workflow work out of the box on Studionet: the script asks the Studio
faucet to fund the throwaway creator and beneficiary, then runs the whole lifecycle. If the faucet is
unavailable, the run still deploys and reads the contract, records the address, and marks the payable
steps `SKIP` rather than pretending they passed.

`VIGIL_TESTER1_*` is the creator. `VIGIL_TESTER2_*` is the beneficiary and, when it has funds, the
address that triggers the refund (refunds are permissionless).

### What the run proves

The script deploys, then asserts on chain state:

| Step | Check |
| --- | --- |
| deploy | receipt is finalized (`FINISHED_WITH_RETURN` when Studio surfaces it), address extracted and printed |
| owner | `get_owner()` is the creator wallet |
| create | `get_vault_count` grows, the card is `ACTIVE`, amount and beneficiary match |
| cancel | state `CANCELLED`, creator credit equals the deposit |
| withdraw | external transfer executes, credit returns to zero |
| refund | a third vault with a 75-second deadline, 80 seconds of waiting, then `REFUNDED` and credit |
| guard | a self-pay vault is rejected by the contract |
| adjudication (true) | `check_vault` on `"The page contains the word 'domain'"` returns `MET`, the vault becomes `TRIGGERED`, and the beneficiary credit equals the deposit |
| adjudication (false) | `check_vault` on a condition the page does not satisfy leaves the vault `ACTIVE` and moves no credit |
| adjudication payout | the beneficiary withdraws the settlement credit and its balance returns to zero |

The step summary carries a result table and the contract address. `studionet-run.json` is uploaded as
an artifact. If the address was recorded, the workflow commits it with an `if: always()` step.

## 4. Manual deployment

If you prefer the CLI:

```bash
pip install genlayer-py
genlayer network set studionet
genlayer account import
genlayer deploy --contract contracts/vigil.py
```

The constructor takes no arguments. Copy the address the CLI prints, run
`node scripts/record-address.mjs <address>`, commit, and push.

After that, the app is live wherever `dist/` is served. `npm run build` produces it.

## 5. Troubleshooting

- **`invalid_contract` on deploy**: the first line must pin the runner hash exactly. Do not change it
  to `py-genlayer:latest`.
- **A write fails with "vault is not active"**: another transaction already settled, cancelled or
  refunded it. Reload the vault.
- **A write fails with "check cooldown is still running"**: one hour must pass between checks of the
  same vault.
- **The wallet is on the wrong chain**: the app offers a switch to Studionet. The chain id is `61999`
  (`0xf22f`), RPC `https://studio.genlayer.com/api`.
- **The deploy step says the wallet is unfunded**: add GEN from the Studio faucet and re-run.
