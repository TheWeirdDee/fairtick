# FairTick working specification

Authority: implementation handoff, then the accepted merged plan, then the
historical PRD. Original requirements are retained in git commit 0a5911d.

| Area | Effective requirement |
| --- | --- |
| Scope | One verified NVDA/USDG BUY route, one operator wallet; buy now before managed orders |
| Pricing | Actual-size quote; integer transaction minimum output enforces the stricter slippage/absolute/reference-relative bound |
| Reference | Read oraclePaused, uiMultiplier, newUIMultiplier and effectiveAt at the evidence block; unknown state blocks signing; never multiply the feed again |
| Sessions | Verified 2026 calendar including early closes; unsupported years are UNKNOWN |
| Gate | Threshold decision is advisory; execution validator must independently check all confirmed limits immediately before signing |
| Persistence | Transactional durable storage and browser-independent worker; SQLite only on an explicitly persistent local volume, Postgres for separate hosts |
| Recovery | Unique fill intents, retained pending reservations, wallet serialization, reconcile signed identity before retry; cancellation/expiry never release unresolved reservations |
| SERV | Finite planning proposals only, full versioned instructions, strict output; failure authorizes nothing |
| Evaluation | Same full prompt/input/schema/settings; removing shadow is an ablation, never a raw-provider claim; score pre-gate and post-gate separately |
| Receipts | Independently reconstruct wallet transfers and pool events; distinguish settlement from mandate compliance |
| Authorization | Read-only calls, local code, tests and simulations only; no approvals, broadcasts, deployment or external messages |

Current release: owner-operated web, public docs, durable worker and testnet mock signer are implemented. Mainnet execution is disabled. SERV authenticated integration is evidenced on synthetic market data. Public-testnet settlement remains BLOCKED until a separately authorized transaction and honest receipt are observed. RELEASE-CHECKLIST.md is the current completion record; historical findings below or in the PRD are not fresh readiness claims.

USDG/USD parity is an explicit assumption for reference-relative bounds, requiring
confirmation; native USDG absolute bounds remain preferable. Gas is separately
denominated in wei. Initial execution commits to a reference round and a concrete
minimum output, not continuously updated oracle enforcement at inclusion.
