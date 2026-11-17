# Deploying the Vigil app to Vercel

The app is a static Vite build. Vercel runs `npm run build` and serves `dist/`. There is **no server,
no API key and no environment variable**: the Studionet contract address is compiled into
`src/lib/genlayer.ts`.

The contract is already live at
`0x0Ae4F21efC452642dE258711aC9739dde4C5b1fC`; deploying the app does not deploy a new contract.

## Before you start

- A Vercel account linked to the GitHub account that owns `weels007/vigil`.
- Vercel access to the repository. The repository is public; if you make it private later, install the
  Vercel GitHub app for the account/repository.
- Node 22.x. Vercel supports 22.x, 24.x and 26.x; **20.x is no longer offered**, so
  `package.json` pins `"engines": { "node": "22.x" }` and Vercel reads it.

## Dashboard (works from a phone)

1. Open `vercel.com/new` and import the `weels007/vigil` repository.
2. In the project settings use:
   - **Framework Preset:** Vite
   - **Root Directory:** `./`
   - **Install Command:** `npm install`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Node.js Version:** 22.x
3. Do **not** add environment variables. In particular do not add `CONTRACT_ADDRESS`; the address is
   a hard-coded constant on purpose.
4. Deploy.

`vercel.json` at the repository root already pins the framework, build, output and static headers, so
the dashboard normally fills these values by itself.

## What `vercel.json` configures

- Vite build from `npm run build` into `dist/`.
- `X-Content-Type-Options: nosniff`, a strict referrer policy and a permissions policy.
- Immutable one-year caching for `/assets/*` (Vite writes content-hashed file names).
- `no-cache`/revalidation for `/` and `/index.html`, so a new deploy is not hidden by a stale shell.

There are deliberately **no rewrites**: the app uses hash routes (`#/vaults`, `#/create`,
`#/activity`), so every page loads from `index.html` on a static host without server routing.

## CLI (optional, desktop)

```bash
npm i -g vercel
vercel
vercel --prod
```

The CLI asks the same questions as the dashboard the first time.

## After the first deploy

- Open the production URL in a browser. The landing page reads live totals and recent vaults from
  Studionet.
- Connect a wallet. The app offers the Studionet switch (`chainId 61999`, `0xf22f`, RPC
  `https://studio.genlayer.com/api`).
- Create a test vault against a public URL, then open its detail page to check the countdown, check
  log and evidence link.
- Copy the production URL into the `Live app:` line of `README.md` and the Links section of
  `SUBMISSION.md`. This repository's current production URL is
  <https://vigil-alpha-eight.vercel.app>.
- From then on, every push to `main` rebuilds the production deployment. Branches get preview URLs.
- A custom domain can be attached in the Vercel project settings.

## Smoke test

1. Landing: totals and recent vaults load (an error state here means the RPC was not reachable).
2. Wallet: connect, and the chain indicator shows Studionet or offers the switch.
3. `#/create`: the form rejects a zero beneficiary and a localhost/private URL locally.
4. Create a vault with a public URL and a future deadline; the detail page shows it.
5. The evidence link opens the public page; the check log shows "never" until someone checks.
6. `#/activity`: the ledger lists the opening and the connected wallet's credit.

## Troubleshooting

- **Build fails before npm install, with a Node.js version error:** Vercel only offers Node 22.x,
  24.x and 26.x. The earlier `20.x` pin is not available and fails the deployment. This repository
  pins `22.x`; if the Vercel project setting is still on 20.x, set it to 22.x in
  Settings → Build and Deployment → Node.js Version.
- **Build fails on Vercel:** run `npm run build` locally; CI runs the same command
  (`tsc --noEmit && vite build`). Fix the first TypeScript error.
- **Blank page:** check the Vercel build log and the browser's network panel. A built `index.html`
  points only to hashed assets in `/assets`.
- **Reads fail with "failed to fetch" or load forever:** the browser could not reach
  `https://studio.genlayer.com/api`. If the RPC blocks the Vercel origin by CORS, the RPC allowlist
  (or a small proxy) is needed; the app is static and cannot proxy by itself.
- **"No browser wallet was found":** `window.ethereum` is not injected in every browser or iframe.
  Open the URL in a wallet's in-app browser (MetaMask, Rabby, etc.) or a desktop browser with the
  wallet extension.
- **Wrong network:** use the app's switch, or add chain `61999` (`0xf22f`) manually.
- **A direct `/vaults` URL 404s:** that path is not a route. The app's routes are hashes:
  `/#/vaults`, `/#/create`, `/#/activity`.

## Security notes

- The app has no secrets, no server and no API keys. Never put a private key in the project.
- Writes are signed by the user's wallet; the app never sees a private key.
- The static headers above are conservative. A strict CSP is intentionally not set because wallet
  extensions inject scripts and styles at runtime and a bad policy would break signing.
- The GitHub repository is public. Do not commit secrets; the app has none.
