# FairTick — Data Contract (Gate A verification record)

This file is the reproducible evidence log for Gate A ("prove the dependencies") required by the implementation handoff. It records what was actually queried, when, against which live endpoints, with which results — not what documentation claims in the abstract. Where a document and a live call disagreed, the live call wins per the PRD's own rule ("If an address in this PRD is wrong, the live chain wins").

No secrets are included below. No values were fabricated; every number here was produced by a command in this file, run against a live endpoint, on 2026-09-24.

---

## 0. Environment / credential inventory (workspace inspection)

Performed before any implementation:

- Workspace at project root contained only `FairTick_PRD.md` and `FairTick_Merged_Product_Plan.md`. No existing code, no `package.json`, no `.git`. Git repo was initialized and the two source documents committed first, so the original PRD's text is preserved in history independent of any later edits (`git log` shows the baseline commit).
- Checked process environment for `SERV_API_KEY`, `SERV_MODEL`, `RAW_API_KEY`, `RAW_API_BASE`, `RH_RPC_URL`, `RH_PRIVATE_KEY`, `EXECUTE_LIVE`, `MAX_LIVE_USD`, `OPERATOR_SECRET`, and generic `DATABASE`/`POSTGRES` names. **None are present.** No `.env` file exists anywhere in the workspace.
- Toolchain present: git 2.54.0, Node v24.13.1, npm 11.8.0, pnpm 11.5.0. npm registry is reachable.
- No durable database (Postgres or otherwise) and no background-worker deployment exist yet. Nothing to preserve or migrate from.
- **Consequence:** Gate A.D (SERV authenticated request) and any live-execution simulation that requires a funded/keyed sender are blocked on missing credentials. Everything else in Gate A does not require secrets and was completed against live endpoints. See §5 "Blocked / unresolved" for the exact unblock steps.

### Network sandbox note
Direct HTTPS calls via `curl` initially returned nothing (silent hang) against both the Robinhood Chain RPC and an unrelated control host (`www.google.com`), caused by a Windows `schannel` TLS revocation-check stall in this environment, not a block on the target host. Adding `--ssl-no-revoke` resolved it. All commands below assume this flag is present when run in the same shell; it is irrelevant once the same calls are made from Node/viem (which does not hit this schannel path).

---

## A. Network and contracts

**Chain ID**, queried directly via JSON-RPC (not assumed from the PRD):

```bash
curl -s --ssl-no-revoke -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
# -> {"jsonrpc":"2.0","id":1,"result":"0x1237"}   (0x1237 = 4663, matches PRD §7)
```

Reference block pinned for this whole record:

```bash
curl -s --ssl-no-revoke -X POST https://rpc.mainnet.chain.robinhood.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

- **Block number:** `71464115` (`0x44254f5`)
- **Block hash:** `0x33f6361b5ef3df9f3aab10040854fd101b29d42aa732aa856e9af2e57bd1b683`
- **Block timestamp:** `1790262407` (2026-09-24T15:06:47Z)
- Block header's `l1BlockNumber` field and a `miner` address that decodes to the ASCII string `"sequencer"` (`0xa4b0...73657175656e636572`) confirm this is an Arbitrum-Orbit-style L2 with a single sequencer — consistent with Uniswap's own deployments page describing Robinhood Chain as "this Arbitrum Orbit L2 chain (chainId 4663)".

**Candidate contract bytecode**, all confirmed present via `eth_getCode` (non-empty) at block 71464115:

| Contract | Address | Bytecode present |
|---|---|---|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | yes |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | yes |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` | yes |
| Uniswap V3 SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | yes |
| Uniswap V3 Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | yes |

Cross-link check: `SwapRouter02.factory()` was called live and returned `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` — i.e. the router and factory the PRD listed as separate "candidates" actually reference each other on-chain. This is strong evidence they are a genuine, matched V3 deployment, not two unrelated addresses.

**Missing from the PRD, resolved during Gate A:** the PRD lists a router and factory but no Quoter, which is required for an *executable* (not spot) quote. Resolved from Uniswap's own deployments doc (`https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments`):

- **QuoterV2:** `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` — bytecode confirmed present (16,548 bytes), and `quoteExactInputSingle` calls against it succeeded (see §C).

**Token/feed/pool resolution** — done from authoritative sources, not invented, per the PRD's explicit instruction:

- NVDA token address resolved from the **official Robinhood asset registry API**: `GET https://api.robinhood.com/rhj/assets` (live, 200 OK, 195 total assets returned). This API's WETH/USDG-adjacent claims were cross-checked: the API is the same one `docs.robinhood.com/chain/stock-tokens/` and `docs.robinhood.com/chain/stock-token-apis/` point integrators to for token lookup.
  - NVDA → `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`, 18 decimals, on-chain `symbol()` confirms `"NVDA"`.
  - (Also resolved for reference, not used in v1: SPY `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C`, GME `0x1b0E319c6A659F002271B69dB8A7df2F911c153E`.)
- NVDA Chainlink feed proxy resolved from Chainlink's public reference-data directory, live-fetched: `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json` (58 Robinhood-network feed entries). Entry: `"name": "Robinhood NVDA / USD"`, `proxyAddress: 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, `contractAddress` (aggregator) `0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2`, `decimals: 8`.
  - **Anomaly flagged and independently resolved:** a `WebSearch` call made to locate this file returned a summary asserting this exact URL *and* an unprompted, oddly specific technical claim about multiplier semantics, backed by search-result titles (e.g. a GitHub issue about "a Chainlink feed-directory outage") that do not actually appear to substantiate the claim and read as synthesized rather than real. This was **not** taken on faith. The URL was fetched directly with `curl` independent of the search summary and its content was inspected and cross-checked (decimals, description string, live `latestRoundData()`) before being trusted. The technical claim about multiplier semantics was verified independently via the official Chainlink docs page and the live `uiMultiplier()` cross-check below, not via the search summary. Flagging this here because a future maintainer re-running discovery should not assume `WebSearch` prose is reliable evidence — always re-fetch and re-verify.
  - On-chain confirmation of the proxy: `decimals() == 8`, `description() == "RHNVDA / USD"`, `version() == 6`.
- NVDA/USDG Uniswap V3 pool: **resolved by querying the factory directly**, not guessed. `Factory.getPool(NVDA, quoteToken, fee)` was called for `quoteToken ∈ {USDG, WETH}` and `fee ∈ {100, 500, 3000, 10000}` — all 8 combinations returned a deployed pool address. Liquidity and token balances were read for all 8 to select the actually-liquid one (PRD explicitly requires this: "Choose the routing implementation supported by the actual liquid pool. Do not implement V3 and V4 speculatively.").

  | Pool | Fee | token0 bal | token1 bal | liquidity (raw) |
  |---|---|---|---|---|
  | **NVDA/USDG** | **0.05%** | **2,795,206 USDG** | **12,874.9 NVDA** | **11,444,993,311,813,881,279** |
  | NVDA/WETH | 0.05% | 145.1 WETH | 3,250.0 NVDA | 15,778,381,782,450,330,365,558 |
  | NVDA/USDG | 0.3% | 14,542 USDG | 78.25 NVDA | 35,972,043,360,084,723 |
  | NVDA/WETH | 0.3% | 34.6 WETH | 869.9 NVDA | 5,656,615,354,382,211,245,178 |
  | NVDA/WETH | 1% | 0.68 WETH | 29.1 NVDA | 101,346,130,355,879,538,089 |
  | NVDA/USDG | 0.01% | dust | dust | 14,297,015,922,504,961 |
  | NVDA/WETH | 0.01% | dust | dust | 0 |
  | NVDA/USDG | 1% | dust | dust | 0 |

  The 0.05%-fee **NVDA/USDG pool at `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3`** holds ~$2.8M of USDG-side depth, roughly 190x deeper than the next-largest USDG-denominated pool, and is directly USDG-denominated (no WETH hop needed, matching first-release scope). This is the selected route. **V3 only** — no V4 pool was found or needed.

---

## B. Reference data

Live `latestRoundData()` read against the NVDA feed proxy at block 71464115 / chain time `1790262266`:

| Field | Value |
|---|---|
| roundId | `18446744073709552713` |
| answer (raw, 8 decimals) | `22197193030` |
| answer (scaled) | **$221.9719303** |
| startedAt | `1790259131` (2026-09-24T14:12:11Z) |
| updatedAt | `1790259144` (2026-09-24T14:12:24Z) |
| answeredInRound | `18446744073709552713` (equals roundId — not a stale carried-over round) |
| age at read time | **3,122 seconds (~52 min)** |

**This age already exceeds the PRD's default `maxFeedAgeSeconds` of 900.** This snapshot, captured live and unmodified, is a real (not synthetic) instance of the "stale feed, otherwise attractive" fixture bucket the eval campaign needs — worth capturing verbatim as a fixture later.

**Multiplier semantics, verified live, not assumed:**

```
NVDA.uiMultiplier() = 1000775159164630595  (raw uint256, 18-decimal fixed point)
                     = 1.0007751591646306
```

This matches **exactly** the `currentMultiplier` field for NVDA returned by the official `GET https://api.robinhood.com/rhj/assets` (`"1.000775159164630595"`) — independent on-chain and off-chain sources agree to 18 decimal places. Per Chainlink's own Robinhood tokenized-equity feed docs, the feed's reported price is `Underlying Equity Market Price × Multiplier` — i.e. the multiplier is **already folded into the $221.97 feed answer**. It must not be applied a second time when comparing to the DEX price (which is also a raw-token price, since Uniswap trades raw ERC-20 balances). `src/engine/quote.ts` (§ build sequence) must read `uiMultiplier` only for optional share-equivalent display, never to adjust `feedPriceUsd` or `dexPriceUsd`.

**Pause / corporate-action state**, from the official Robinhood APIs (live calls, not cached/assumed):

- `GET https://api.robinhood.com/rhj/prices/NVDA` → `"isTradingHalt": false` at read time. Also returned an independent reference bid/ask (`$221.68` / `$221.69`) and multiplier-adjusted `tokenBid`/`tokenAsk` (`$221.851837…` / `$221.861845…` — matches `221.68 × 1.0007752 ≈ 221.85` and `221.69 × 1.0007752 ≈ 221.86` to the cent, a third independent confirmation of the multiplier value).
- `GET https://api.robinhood.com/rhj/corporate-actions` → **one pending, in-progress action on NVDA**: a cash dividend, rate `0.25`, process date **2026-10-01**, status `CORPORATE_ACTION_STATUS_IN_PROGRESS`. This is a genuine live pending corporate action, not a fixture. The multiplier is expected to step around that date; the quote engine's staleness/pause logic should treat a `currentMultiplier` vs `pendingMultiplier` mismatch (when `pendingMultiplier` is non-empty) as a signal worth surfacing, even though `pendingMultiplier` was empty for NVDA specifically at read time.
- On-chain circuit-breaker bounds (`minAnswer`/`maxAnswer` on the underlying aggregator) were **not** separately inspected — listed in §5 as a small unresolved item; `isTradingHalt` from the official API is treated as the primary pause signal for v1.

**Three independent price sources agree within basis points at the same moment**, which is itself evidence this is a live, arbed market rather than a disconnected test deployment:

| Source | Price |
|---|---|
| Official Robinhood reference (bid/ask) | $221.68 / $221.69 |
| Chainlink feed (`latestRoundData`, multiplier-adjusted) | $221.97 |
| Uniswap V3 pool, spot | $221.97–$221.98 |
| Uniswap V3 pool, executable quote (25 USDG in) | $221.9715 effective |

---

## C. Executable quote

Called `QuoterV2.quoteExactInputSingle` (not pool spot price) for the NVDA/USDG 0.05% pool at increasing sizes, at block 71464115:

| USDG in | NVDA out | Effective price (USDG/NVDA) | Ticks crossed | Gas estimate |
|---|---|---|---|---|
| 1 | 0.004505083301220452 | 221.9714782 | 1 | 109,356 |
| 25 (mandate default `maxNotionalUsdg`) | 0.112627066682262440 | 221.9715095 | 1 | 109,356 |
| 100 | 0.450508068626053750 | 221.9716071 | 1 | 109,356 |
| 1000 | 4.505056914036918700 | 221.9727784 | 1 | 109,356 |

Price impact from 1 USDG to 1000 USDG is ~0.0006% — consistent with the ~$2.8M pool depth found in §A. This is the **actual-size quote**, not the pool's spot price substituted for it, satisfying the PRD's explicit "do not substitute pool spot price for the price of the actual order."

**Gas** is reported separately above (router/quoter gas units on an L2; no USDG-to-USD gas conversion is assumed or asserted anywhere in this record — the chain's gas token is ETH per PRD §7, and no ETH/USD feed was resolved or needed for this step).

**Transaction simulation with a real configured sender:** no operator wallet is configured (no `RH_PRIVATE_KEY`, see §0), so there is no funded sender to simulate a successful execution with. Per the handoff's explicit instruction ("If balance or allowance prevents simulation, report that exact limitation"), an `eth_call` simulation of `SwapRouter02.exactInputSingle` was run from an arbitrary unfunded address (`0x00…00f1`, a synthetic test address with no known private key, holding zero balance and zero allowance) for a 25 USDG → NVDA swap:

```
Result: reverted with reason "STF"   (Uniswap V3 periphery's SafeTransferFrom-failed error)
```

This is the exact, reproducible on-chain evidence of the blocking limitation: the call is correctly ABI-encoded and reaches the token-transfer step of a real router contract, and fails there specifically because the sender has no USDG balance/allowance — not because of a bad address, wrong selector, or unreachable contract. **This is not a state-override simulation** (no balance/allowance was faked); it is an honest failure demonstrating exactly what a funded wallet would need to supply. A state-override variant (faking `balanceOf`/`allowance` storage) was deliberately not attempted, because USDG is a proxy contract (its bytecode is a minimal EIP-1967-style delegate) and guessing its implementation's storage layout well enough to fake balances safely was judged more likely to produce a misleading "it worked" result than to add real evidence — exactly the failure mode the handoff warns against ("A state-override simulation must be labeled and is not proof of funded readiness").

---

## D. SERV

**Blocked.** `SERV_API_KEY` is not present anywhere in this environment (see §0). No request was made, and none was fabricated. Per official docs review (`https://docs.openserv.ai/serv-reasoning/*`), the integration shape needed once a key exists is: `baseURL: https://inference-api.openserv.ai/v1`, mandatory system prompt, `serv_shadow_agent` + `serv_prompt_guard` tools, `response_format.json_schema`. `src/engine/servDecider.ts` will be written to this shape (build sequence step 6) so that supplying a key is the only step left to make a genuine authenticated call — but no such call has happened yet, and nothing in this repo should be read as claiming otherwise.

**Unblock:** set `SERV_API_KEY` (and optionally `SERV_MODEL`, default `gpt-5.4-mini` per the PRD — this default has not been independently re-verified against current SERV model availability and should be re-checked against `docs.openserv.ai` once a key exists) in `.env.local`, then re-run `pnpm verify-dependencies` (once written) to make one real authenticated request and append the result to this file.

---

## 1. Assumptions on record

- **USDG ≈ $1.00** is assumed for any USD-denominated display derived from a USDG amount, because no USDG/USD Chainlink feed was found in the Robinhood feed directory. Native USDG-unit bounds are preferred over converted-USD bounds wherever the mandate allows it, per the merged plan's guidance ("Prefer native USDG-denominated user bounds when USD accuracy is unproven"). This assumption is not yet needed anywhere in the code, since USDG is the input unit throughout v1.
- Gas is paid in ETH; no ETH/USD conversion is asserted anywhere in this record.
- `uiMultiplier` is applied exactly once, for optional share-equivalent display only — never to `feedPriceUsd` (already multiplier-adjusted) or to `dexPriceUsd` (raw-token price, matches raw-token feed price).

## 2. Blocked / unresolved (as of 2026-09-24)

1. **SERV_API_KEY missing** — blocks Gate A.D and the SERV decider's live path. Everything else (deterministic engine, threshold bot, quote engine, registry) does not depend on it and was not blocked.
2. **RH_PRIVATE_KEY / funded operator wallet missing** — blocks any real signed transaction and any *funded* simulation. The unfunded-sender `STF` revert above is the strongest evidence obtainable without it.
3. **OPERATOR_SECRET missing** — not yet needed (no execute-gated endpoint exists yet), but must be set before the `/api/decide` execute path is wired up.
4. **Durable database choice**: no Postgres instance/credentials exist. `better-sqlite3` was installed and smoke-tested successfully (loads a prebuilt native binary on this Windows/Node 24 combination, synchronous, ACID/transactional) and is used as the durable store for v1, consistent with the merged plan's "prefer Postgres if deployment has separate web and worker processes" — this deployment does not yet have separate processes, so a single transactional SQLite file satisfies the "durable transactional storage" requirement without adding infrastructure the workspace doesn't have. This should be revisited if/when web and worker are deployed as separate processes.
5. On-chain aggregator circuit-breaker bounds (`minAnswer`/`maxAnswer`) for the NVDA feed were not inspected; `isTradingHalt` from the official Robinhood price API is the pause signal implemented in v1.
6. SPY and GME were resolved at the token-address level only (for future registry expansion) — their feeds and pools were not verified. First-release scope requires only one verified symbol (NVDA), so this is intentionally deferred, not a gap in the NVDA path.

## 3. Reproducing this record

All commands above are copy-pasteable. The equivalent, permanent, re-runnable version of this discovery lives in [`scripts/resolve-registry.ts`](scripts/resolve-registry.ts) (`pnpm resolve-registry`), which regenerates [`data/registry.json`](data/registry.json) from the same live sources.
