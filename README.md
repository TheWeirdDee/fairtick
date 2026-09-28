# FairTick

An owner-operated order workspace: confirm a token budget, maximum price and expiry; let an independent worker check conditions; inspect application-rule decisions, bounded SERV proposals and transaction evidence.

**Mainnet signing is disabled. Testnet signing is implemented only for explicitly labeled FairTick mock tokens and an operator-set price.** One purchase was finalized and verified on Robinhood Chain public testnet: [transaction `0x6ff3ed3a...be0ce16`](https://explorer.testnet.chain.robinhood.com/tx/0x6ff3ed3ac70b618b8ae7f244025a4a7177f2b4cea00b3ae5c8645c083be0ce16). It spent 25 valueless mock mUSDG and received 0.111043223588669236 valueless mock mNVDA through operator-seeded controlled liquidity. The 225 reference price came from an operator-set mock feed. This was not an official stock-token market, Chainlink market data, or official Uniswap liquidity, and it does not establish mainnet readiness.

## Reproduce locally

Use Node 24 and npm. Do not configure a mainnet private key.

```sh
npm ci
npm run setup-local
npm run db:migrate
npm run build
npm start
# Separate terminal, same persistent database:
npm run worker
```

Open http://localhost:3000. Public routes need no code. Owner sign-in is `/access`; `setup-local` creates OPERATOR_SECRET in the ignored `.env.local` only if absent. Read it locally; never publish it. The browser exchanges the code for an eight-hour HttpOnly session cookie. Sign-out revokes it. Private APIs also accept the owner Bearer credential for local tooling.

Mainnet observation uses NVDA/USDG and blocks on missing/stale prerequisites. An API key alone does not establish SERV account eligibility or sufficient credit. Real SERV evidence from September 25 is recorded on **synthetic market data**, with a validated proposal and no transaction authority.

## Testnet mock workflow

```sh
npm run testnet:compile
npm run testnet:deploy   # READ-ONLY plan, wallet balance, nonce and funding allowance
```

The separate testnet wallet, registry and database must never reuse mainnet configuration. Mock mUSDG/mNVDA, an operator-set feed and operator-seeded pool are not official stock tokens or a real market. Faucet funds are valueless. Deployment, setup, approval, price refresh and execution need separate broadcast authorization before using any `--broadcast` command or enabling the signer.

After separately authorized deployment, start `npm run testnet:web` and the independent `npm run testnet:worker`. The worker requires FAIRTICK_TESTNET_EXECUTE=true for signing. The web process does not need a private key. See [OPERATIONS.md](OPERATIONS.md) and [PUBLIC-TESTNET-PLAN.md](PUBLIC-TESTNET-PLAN.md).

## Verification

```sh
npm test
npm run typecheck
npm run build
npm run verify:browser
npm run testnet:local-e2e -- --planner stand-in --browser
```

The last command requires `.tools/foundry/anvil.exe`, deploys only to loopback, uses an ephemeral wallet and a clearly synthetic planner, and spends no SERV credit. It checks the actual UI, worker logic and local receipt; it cannot satisfy the public-testnet gate. `verify:browser` uses installed Chrome by default (PLAYWRIGHT_CHANNEL=msedge is supported), isolated synthetic orders, read-only live RPC and a separate worker process. Neither command publishes the owner database.

The retained public-testnet record is `public/evidence/public-testnet-status.json`. It documents one finalized transaction using valueless FairTick mock mUSDG/mNVDA, an operator-set price and controlled liquidity. Token settlement, the transaction-specific actual fee, and all recorded mandate checks are verified. This evidence does not establish mainnet readiness.

## Architecture and boundaries

Next.js web and a separate Node worker share SQLite WAL on one host with a persistent local volume. Migrations preserve existing rows. Immutable mandates, wallet-level pending constraints, nonce ownership, signed-byte recovery and pending reservations prevent an unknown outcome from authorizing a second fill. A stale unsigned recovery job requires operator review; it never silently releases funds. Receipt settlement, mandate compliance, fees and finality are separate findings.

[Public docs source](src/app/docs) covers access, orders, SERV, networks, receipts, self-hosting and limitations. [DATA-CONTRACT.md](DATA-CONTRACT.md) preserves dated dependency observations. [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md) is the gate checklist. [SUBMISSION.md](SUBMISSION.md) contains draft entry text and demo material. [OPERATIONS.md](OPERATIONS.md) describes deployment, recovery and data handling.

The public source repository is [github.com/TheWeirdDee/fairtick](https://github.com/TheWeirdDee/fairtick). No live deployment or mainnet readiness is claimed. This release has no signup, multi-user isolation, billing or validated revenue model.
