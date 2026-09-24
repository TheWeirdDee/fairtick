# FairTick

FairTick checks a Robinhood Chain stock-token purchase against your own written limits — max spend, max price vs the official reference, how stale a feed you'll accept, which market sessions you'll trade in — and only executes when every rule passes. It can attempt one purchase now, or keep working an order until the budget is filled, a deadline arrives, or you cancel.

**Status: foundation under active build, pre-submission.** This README says exactly what is real today and what is not yet built. Live URL: none yet (not deployed). Eval: not run yet — no `/proof` numbers exist to quote.

## What's actually verified right now

Everything in [`DATA-CONTRACT.md`](DATA-CONTRACT.md) was produced by a live call against Robinhood Chain mainnet (chain id 4663) or an official Robinhood/Chainlink/Uniswap source on 2026-09-24, not assumed from documentation:

- Chain ID, core contract bytecode (USDG, WETH, Multicall3, Uniswap V3 Factory/SwapRouter02), and a resolved QuoterV2 (missing from the original spec, found via Uniswap's own deployments doc).
- NVDA token, its Chainlink `RHNVDA / USD` feed, and its Uniswap V3 pool — selected by actually comparing live liquidity across every fee tier and quote-token pairing, not assumed. The NVDA/USDG 0.05% pool (~$2.8M depth) is the route.
- A live, actual-size executable quote (`QuoterV2.quoteExactInputSingle`, not pool spot price) at several sizes, with measured price impact and gas.
- The exact on-chain revert (`STF`) proving what a funded wallet would need to supply, since no operator wallet is configured yet.
- A genuine pending NVDA corporate action (cash dividend, processing 2026-10-01) and a live trading-halt read, both from Robinhood's official API — not fixtures.

Run `pnpm resolve-registry` to redo this discovery live and regenerate `data/registry.json`. Run `pnpm smoke-quote` (or `tsx scripts/smoke-quote.ts`) to pull one live `MarketSnapshot` end to end.

## What's built

- Domain types reconciling the original PRD with the merged product plan (`src/engine/types.ts`).
- A pure `SessionClock` (`src/engine/session.ts`) — no network, no LLM, verified against the spec's own America/New_York test vectors.
- `premiumBps` math (`src/engine/premium.ts`) as the single source of truth no decider may override.
- The live `QuoteEngine` (`src/engine/quote.ts`) — feed + actual-size quote + session, all from chain, with an explicit `UNABLE/STALE/PAUSED/UNAVAILABLE` reference-status model instead of silently substituting a price.
- The deterministic threshold bot / hard-gate validator (`src/engine/thresholdBot.ts`) — the rules-based baseline every model-driven decision is measured against and gated by.
- 27 passing tests (`pnpm test`) covering session boundaries, premium math, and one case per PRD §18 fixture bucket.

## What's not built yet

- SERV decider, raw-model comparison, and the `/proof` eval campaign — blocked on `SERV_API_KEY`, which is not present in this environment. No SERV call has been made; none is claimed.
- Durable order storage, the managed-order worker, partial fills, cancellation/expiry, and receipt reconstruction (merged plan §6-§9).
- Any signed transaction — blocked on an operator wallet (`RH_PRIVATE_KEY`). No live trade has been executed; none is claimed.
- The desk, order, receipt, and proof pages (no Next.js UI exists yet — this is intentionally engine-first per the build order).

## Setup

```bash
npm install
cp .env.example .env.local
# fill in SERV_API_KEY / RH_PRIVATE_KEY / OPERATOR_SECRET only if you have them —
# the deterministic engine and live quotes work without any of them.
npm run resolve-registry   # re-verify live and regenerate data/registry.json
npm test                   # 27 tests, no credentials required
npm run smoke-quote        # one live end-to-end MarketSnapshot
```

## Scope for this release

One verified stock token (NVDA). BUY only. USDG input. One route (Uniswap V3, NVDA/USDG 0.05%). One operator-controlled execution wallet, not yet configured. See [`FairTick_Merged_Product_Plan.md`](FairTick_Merged_Product_Plan.md) for the full reconciled plan and [`FairTick_PRD.md`](FairTick_PRD.md) for the original spec (the merged plan takes precedence where they differ).

## Limitations on record

- USDG is assumed ≈ $1.00 for any USD display derived from a USDG amount; no USDG/USD feed exists in the Robinhood feed directory. Native USDG-unit bounds are used wherever possible instead.
- No official Robinhood brokerage MCP, mint/redeem, or account access is used or implied anywhere in this repo.
- Nothing here claims to identify a guaranteed bargain, predict a price, or prove a squeeze from a price divergence.
