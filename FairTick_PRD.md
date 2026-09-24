# FairTick PRD

**Product:** FairTick  
**One line:** An execution desk for Robinhood Chain Stock Tokens that decides whether an off-hours or live print is a real discount, closed-market drift, or a squeeze — then swaps only when the mandate allows.  
**Track:** SERV Hackathon Edition 01 — Mainnet & MCP  
**Deadline:** 2026-09-28 00:00 UTC  
**Stack:** TypeScript, Next.js App Router, viem, OpenAI SDK pointed at SERV, Uniswap on Robinhood Chain.

This document is the build contract. If implementation disagrees with live chain, RPC, SDK, or SERV behavior, change this document and the code in the same pass. Do not keep building against a disproven assumption.

---

## 1. What we are building

FairTick is a product a person can use in one screen.

The user names a Stock Token and a mandate (side, max notional in USDG, how rich they will pay, how stale a feed may be, what to do when cash markets are closed). FairTick reads the Uniswap price and the official Chainlink tokenized-equity feed on Robinhood Chain, computes the premium in basis points in deterministic code, classifies the cash-market session, then asks SERV to choose:

- `TAKE` — execute now, up to a computed size
- `WAIT` — do not trade; cash open or a fresher feed is the right next step
- `REFUSE` — the print is rich, squeezed, or mandate-invalid
- `UNKNOWN` — required inputs are missing; do not invent them

If the decision is `TAKE` and the operator has enabled live execution, FairTick swaps USDG ↔ Stock Token on Uniswap, then re-reads the fill and the feed from chain and writes a receipt.

SERV does judgment. Code does money math, session clocks, swaps, and verification. A raw model and a dumb threshold bot run on the same packets so we can show whether SERV changes outcomes.

---

## 2. What we are not building

- Official Robinhood brokerage MCP / OAuth / US equities account
- Token, points, leaderboard, social feed
- Multi-agent organization, policy-engine product, or generic copilot chat
- Multi-chain routing, bridging UI, or mint/redeem as an authorized participant
- Full portfolio management, tax lots, or options
- Fake activity, mocked prices presented as live, or hardcoded eval winners
- A marketing site that is not the desk

If funds or RPC prevent a live swap, ship live quotes + live decisions + a clearly labeled captured swap replay. Never label a replay as live.

---

## 3. Who it is for

**Primary user:** someone already buying or selling a Robinhood Chain Stock Token on Uniswap who cares whether they are paying up to the cash market — especially nights and weekends, when ~60% of stock-token flow already happens and mint/redeem is constrained.

**Secondary user:** a small agent treasury that must follow a written mandate instead of clicking Uniswap blind.

Not the target: 25-minute memecoin round-trip flow that wants volatility, not a fair print.

---

## 4. The job

Existing flow today:

1. Open Uniswap / a RH-Chain terminal
2. Buy NVDA (or SPY, GME, …) with USDG
3. Hope the on-chain price is close to the real stock

What goes wrong now:

- DEX price and the Chainlink Stock Token feed are different numbers
- Divergence is normal when US cash markets are closed
- `uiMultiplier` on the token makes raw ERC-20 balances lie about share-equivalent size
- Stock-meme pools can pin a large share of on-chain float and shove the token off the reference

FairTick’s job: produce an executable decision and, when allowed, a verified fill.

---

## 5. Success definition

A build is done when all of the following exist:

1. Live quote card for at least NVDA, SPY, GME (or the most liquid three names found at build time).
2. One mandate → one `DecisionPacket` with `TAKE | WAIT | REFUSE | UNKNOWN`.
3. Deterministic `premium_bps`, `feed_age_seconds`, `session`, `max_size_usdg` never computed by the model.
4. SERV path uses `https://inference-api.openserv.ai/v1`, a required system prompt, structured JSON, `serv_shadow_agent`, and `serv_prompt_guard`.
5. Three-way comparison on a frozen fixture set (≥30 packets):
   - FairTick + SERV
   - same model via SERV disabled / raw provider (see §12)
   - threshold bot: `if premium_bps <= max_rich_bps and feed_age <= max then TAKE else REFUSE`
6. At least one positive live or labeled-replay swap whose fill premium is recomputed from chain logs + feed, not from our database.
7. Cases: TAKE on a cheap fresh print; WAIT on a stale or closed-but-ambiguous print; REFUSE on a rich print or “just buy it”; UNKNOWN when the feed is missing.
8. Public pages: `/` desk, `/run/[id]` receipt, `/proof` comparison table.
9. README leads with the user outcome, not architecture.

Headline result to measure, not invent:

> On the frozen packet set, SERV+FairTick invalid-action rate is lower than the threshold bot and lower than the raw model, where invalid = TAKE when rich beyond mandate, TAKE on a stale feed, or TAKE when the session policy is WAIT.

If SERV does not beat the threshold bot, the product still ships as a deterministic desk. The README and UI must then say SERV did not improve this workload. Do not change the metric after seeing the table.

---

## 6. System overview

```
Mandate
   + QuoteEngine (RPC: DEX TWAP/spot, Chainlink latestRoundData, uiMultiplier, pool depth)
   + SessionClock (NYSE regular / pre / post / closed / weekend)
        → MarketSnapshot (pure data)
        → three deciders on the same snapshot:
              ThresholdBot
              RawModelDecider
              ServDecider  → schema validate → shadow hint already on request
        → if operator TAKE and execution enabled:
              SwapExecutor (cap, slippage, deadline)
        → SettlementVerifier (receipt logs + feed reread)
        → RunRecord
```

All three deciders consume identical `MarketSnapshot` JSON. No decider is allowed to fetch extra market data. That keeps the comparison honest.

---

## 7. Network constants

Verify every address on explorer before using it. If an address in this PRD is wrong, the live chain wins.

| Item | Value |
|---|---|
| Chain | Robinhood Chain mainnet |
| Chain ID | `4663` |
| Gas token | ETH |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| Uniswap SwapRouter02 (candidate) | `0xCaf681a66D020601342297493863E78C959E5cb2` |
| Uniswap V3 factory (candidate) | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` |

Prefer `RH_RPC_URL` env (Alchemy/Chainstack/QuickNode). Fall back to the public RPC.

Stock Token and Chainlink feed addresses: do **not** invent them. Resolve at build from:

- https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood
- official Robinhood Chain token lists / explorer token pages

Write resolved addresses into `data/registry.json` with source URL and date. Ship at least three names that have both a feed and a USDG (or WETH) Uniswap pool with observable liquidity.

---

## 8. Domain model

### 8.1 Mandate

```ts
type Side = "BUY" | "SELL";
type ClosedPolicy = "WAIT" | "ALLOW_IF_CHEAP" | "ALLOW";

interface Mandate {
  id: string;
  symbol: string;               // e.g. "NVDA"
  side: Side;
  maxNotionalUsdg: number;      // hard cap for one print
  maxRichBps: number;           // BUY: refuse if premium_bps > this
  minCheapBps: number;          // optional: require at least this much cheap to TAKE (0 = not required)
  maxFeedAgeSeconds: number;    // default 900
  closedPolicy: ClosedPolicy;   // default WAIT
  maxSlippageBps: number;       // default 30
  createdAt: string;            // ISO
}
```

Defaults for the demo mandate:

- side `BUY`
- `maxNotionalUsdg` `25`
- `maxRichBps` `15`
- `minCheapBps` `0`
- `maxFeedAgeSeconds` `900`
- `closedPolicy` `WAIT`
- `maxSlippageBps` `30`

`ALLOW_IF_CHEAP` means: when cash markets are closed, TAKE only if `premium_bps <= -minCheapBps` (or `<= -25` if `minCheapBps` is 0) and feed age is inside the cap. This is the interesting weekend case.

### 8.2 MarketSnapshot

Produced only by QuoteEngine.

```ts
interface MarketSnapshot {
  capturedAt: string;
  chainId: 4663;
  symbol: string;
  token: `0x${string}`;
  feed: `0x${string}`;
  pool: `0x${string}`;
  quoteToken: "USDG" | "WETH";
  dexPriceUsd: number;             // 1 token in USD
  feedPriceUsd: number;            // Chainlink token price (already includes multiplier)
  feedDecimals: number;
  feedRoundId: string;
  feedUpdatedAt: number;           // unix seconds
  feedAgeSeconds: number;
  uiMultiplier: string;            // raw uint256 as decimal string
  premiumBps: number;              // (dex - feed) / feed * 10_000
  poolTvlUsd: number | null;
  midDepthUsd: number | null;      // approx ±1% depth if computable, else null
  session: Session;
  notes: string[];                 // e.g. "feed older than 6h", "pool thin"
}
```

`premiumBps` formula, integer-safe as much as practical, documented in code:

```
premiumBps = ((dexPriceUsd - feedPriceUsd) / feedPriceUsd) * 10_000
```

Positive = DEX rich to feed (buyer overpays vs official token price).  
Negative = DEX cheap to feed.

The model never recalculates this field. If SERV returns a different `premium_bps`, discard it and keep the engine value.

### 8.3 Session

```ts
type SessionName =
  | "REGULAR"      // Mon–Fri 09:30–16:00 America/New_York
  | "PRE"          // Mon–Fri 04:00–09:30
  | "POST"         // Mon–Fri 16:00–20:00
  | "OVERNIGHT"    // Mon–Thu 20:00–04:00 next
  | "WEEKEND"      // Fri 20:00 – Mon 04:00
  | "HOLIDAY";     // optional; if calendar missing, do not guess HOLIDAY

interface Session {
  name: SessionName;
  cashMarketOpen: boolean;         // true only for REGULAR
  tz: "America/New_York";
}
```

Use a small built-in US market holiday list for 2026 if easy; otherwise never emit `HOLIDAY`. Wrong holidays are worse than omitting them.

### 8.4 DecisionPacket

```ts
type Action = "TAKE" | "WAIT" | "REFUSE" | "UNKNOWN";

interface DecisionPacket {
  action: Action;
  reason: string;                  // one or two sentences, user language
  ruleHits: string[];              // e.g. ["FEED_STALE", "SESSION_CLOSED", "RICH"]
  sizeUsdg: number;                // 0 unless TAKE
  maxPriceUsd: number | null;      // cap for BUY
  minPriceUsd: number | null;      // floor for SELL
  confidence: "low" | "medium" | "high";
  decider: "serv" | "raw" | "threshold";
  model?: string;
  servRequestId?: string;
  snapshotHash: string;            // sha256 of canonical snapshot JSON
  mandateId: string;
}
```

Allowed `ruleHits` enum (extend only if a test needs it):

`RICH`, `CHEAP`, `FAIR`, `FEED_STALE`, `FEED_MISSING`, `SESSION_CLOSED`, `SESSION_OPEN`, `THIN_POOL`, `SIZE_CAPPED`, `MANDATE_SIDE`, `MISSING_INPUT`, `SQUEEZE_SUSPECTED`

`SQUEEZE_SUSPECTED` may be set by SERV as judgment when mid-depth is thin and premium is wide. Threshold bot never sets it.

### 8.5 RunRecord

Persisted JSON file plus optional sqlite/json store.

```ts
interface RunRecord {
  id: string;                      // ulid
  createdAt: string;
  mode: "live" | "replay" | "fixture";
  mandate: Mandate;
  snapshot: MarketSnapshot;
  decisions: {
    threshold: DecisionPacket;
    raw: DecisionPacket;
    serv: DecisionPacket;
  };
  chosen: "serv";                  // product always acts on SERV packet
  execution?: {
    status: "SKIPPED" | "BROADCAST" | "CONFIRMED" | "FAILED" | "REPLAY";
    txHash?: `0x${string}`;
    explorerUrl?: string;
  };
  settlement?: Settlement;
}
```

### 8.6 Settlement

```ts
interface Settlement {
  verified: boolean;
  method: "chain_logs_plus_feed";
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: string;
  amountOut: string;
  fillPriceUsd: number;
  feedPriceUsdAtVerify: number;
  fillPremiumBps: number;
  feedAgeSecondsAtVerify: number;
  verifiedAt: string;
  notes: string[];
}
```

`verified: true` only when amounts come from the swap transaction receipt/logs (or a decoder of those logs), and the feed is re-read after inclusion. A 200 from the node is not verification.

---

## 9. QuoteEngine

File: `src/engine/quote.ts`

Responsibilities:

1. Load `data/registry.json` for symbol → token, feed, pool, fee tier, quote token.
2. Multicall:
   - ERC-20 `decimals`, `symbol`
   - token `uiMultiplier()` if present; if the call fails, record `uiMultiplier` unknown and continue with feed price only
   - feed `decimals()` and `latestRoundData()`
   - pool `slot0` / liquidity / token0 / token1 (Uniswap V3) or equivalent V4 read if the registry pool is V4
3. Convert pool price to USD.
   - If pair is TOKEN/USDG, USDG ≈ $1.00 unless a USDG feed exists; document the $1 assumption.
   - If pair is TOKEN/WETH, multiply by an ETH/USD feed if available in registry; else mark `dexPriceUsd` unknown and force `UNKNOWN`.
4. `feedAgeSeconds = now - feedUpdatedAt`.
5. Compute `premiumBps`.
6. Estimate pool TVL and optional ±1% depth. If estimation is unreliable, set null. Do not fake depth.
7. Attach `SessionClock.now()`.

Failure policy: any missing feed, non-positive feed price, or failed pool read → snapshot with `notes` and let deciders return `UNKNOWN`. Do not substitute CoinGecko or another off-chain price for the official feed.

Unit tests with fixtures: known `dex`, `feed` → expected `premiumBps` within 0.1 bps.

---

## 10. SessionClock

File: `src/engine/session.ts`

Pure function `sessionAt(date: Date): Session`.

Test vectors (America/New_York):

- 2026-09-24 15:00 UTC = 11:00 EDT Thursday → REGULAR
- 2026-09-26 18:00 UTC = 14:00 EDT Saturday → WEEKEND
- 2026-09-25 21:00 UTC = 17:00 EDT Friday → POST
- 2026-09-25 01:00 UTC = 21:00 EDT Thursday → OVERNIGHT

Do not call an LLM for this.

---

## 11. Threshold bot (baseline)

File: `src/engine/thresholdBot.ts`

No model. Rules in this order, first match wins after hard stops:

1. Missing dex or feed price → `UNKNOWN` / `MISSING_INPUT`
2. `feedAgeSeconds > mandate.maxFeedAgeSeconds` → `WAIT` / `FEED_STALE`
3. BUY and `premiumBps > mandate.maxRichBps` → `REFUSE` / `RICH`
4. SELL and `premiumBps < -mandate.maxRichBps` → `REFUSE` (selling cheap)
5. `session.cashMarketOpen === false` and `closedPolicy === WAIT` → `WAIT` / `SESSION_CLOSED`
6. `session.cashMarketOpen === false` and `closedPolicy === ALLOW_IF_CHEAP`:
   - cheap threshold = `mandate.minCheapBps > 0 ? mandate.minCheapBps : 25`
   - BUY TAKE only if `premiumBps <= -cheapThreshold`
   - else `WAIT`
7. BUY and `mandate.minCheapBps > 0` and `premiumBps > -mandate.minCheapBps` → `WAIT` / `FAIR`
8. Else `TAKE` with `sizeUsdg = min(maxNotional, midDepthUsd * 0.1 if present else maxNotional)`

This bot is the thing SERV must beat. Do not weaken it to make SERV look good.

---

## 12. SERV decider

File: `src/engine/servDecider.ts`

### Client

```ts
import OpenAI from "openai";

export const serv = new OpenAI({
  baseURL: "https://inference-api.openserv.ai/v1",
  apiKey: process.env.SERV_API_KEY,
});
```

Model default: `gpt-5.4-mini` (override with `SERV_MODEL`).  
Every request **must** include a system prompt or SERV rejects it.

### Tools on every SERV call

```ts
tools: [
  { type: "function", function: { name: "serv_prompt_guard" } },
  {
    type: "function",
    function: {
      name: "serv_shadow_agent",
      parameters: {
        type: "object",
        properties: {
          hint: {
            type: "string",
            default:
              "Action must be TAKE, WAIT, REFUSE, or UNKNOWN. Size must be 0 unless TAKE. Do not invent prices. Honor stale-feed and closed-session policies. premium_bps in the user message is authoritative.",
          },
          max_iterations: { type: "integer", default: 3 },
        },
      },
    },
  },
]
```

Do not add `serv_disable_content_filter`.

### Structured output

Use `response_format.json_schema` named `decision_packet` matching §8.4 fields the model is allowed to set:

Allowed model fields: `action`, `reason`, `ruleHits`, `sizeUsdg`, `maxPriceUsd`, `minPriceUsd`, `confidence`.

Server overwrites: `decider: "serv"`, `snapshotHash`, `mandateId`, `model`, and ignores any model-supplied `premiumBps`.

If JSON parse or schema validation fails → `UNKNOWN` with reason `SERV_OUTPUT_INVALID`. Count this as a SERV failure in the eval, not a silent retry loop beyond one retry.

### System prompt (versioned, file `src/prompts/fairtick.v1.txt`)

The prompt must state:

- Role: execution officer for one Stock Token print, not a market commentator.
- Authoritative inputs: the snapshot numbers in the user message. Do not recompute premium. Do not browse. Do not use training-memory prices.
- Four rulebooks that can conflict:
  1. Mandate (side, max notional, max rich bps, min cheap bps)
  2. Integrity (stale feed → WAIT/UNKNOWN, never TAKE)
  3. Session (`closedPolicy`; weekend drift is not automatically a bargain)
  4. Honesty (missing inputs → UNKNOWN; never fill gaps)
- Wide premium plus thin pool may be a squeeze, not an opportunity (`SQUEEZE_SUSPECTED` + REFUSE or WAIT).
- Size only on TAKE, never above `maxNotionalUsdg`, shrink if `midDepthUsd` is small.
- Reason in plain English a trader can read in five seconds.

User message is the canonical JSON of `{ mandate, snapshot }` only.

### Raw model decider

Same schema and same user JSON. Differences:

- `baseURL` = raw OpenAI-compatible provider if `RAW_API_BASE` and `RAW_API_KEY` exist; otherwise call SERV **without** `serv_shadow_agent` and with a stripped system prompt that says “answer with the schema, no extra checks.” Label this honestly in the proof table as `raw_same_model_no_shadow` if a separate provider key is missing.
- `decider: "raw"`

Never pretend a second provider was used if it was not.

### Runtime rule after SERV returns

Even SERV `TAKE` is rejected by a hard gate before broadcast:

- feed stale → cannot TAKE
- BUY and premium > maxRichBps → cannot TAKE
- size > maxNotional → clamp
- missing prices → cannot TAKE

Log `HARD_GATE_OVERRIDE` on the run when this fires. That is product behavior, not a hidden eval cheat: the chain will not send a mandate-breaking swap. The eval table still scores SERV’s *pre-gate* packet so we can see whether SERV needed the gate.

---

## 13. Execution

File: `src/engine/swap.ts`

Enabled only when `EXECUTE_LIVE=true` and `RH_PRIVATE_KEY` is set.

Rules:

- Hard USDG cap per tx: `min(mandate.maxNotionalUsdg, process.env.MAX_LIVE_USD = 25)`
- Chain ID asserted 4663 before sign
- Approve USDG/WETH to router only for the exact amount
- Uniswap exact-in swap, slippage from mandate
- Deadline 2 minutes
- Refuse to send if quoted dex price moved more than `maxSlippageBps` since snapshot
- One inflight swap at a time
- Store raw tx hash immediately

If keys are absent: API returns the SERV packet with `execution.status = SKIPPED` and the UI shows “decision only.”

Do not implement official Robinhood MCP trading.

---

## 14. Settlement verifier

File: `src/engine/verify.ts`

After `CONFIRMED`:

1. `getTransactionReceipt`
2. Decode swap logs (Uniswap V3 `Swap` or V4 equivalent)
3. amounts in/out → `fillPriceUsd`
4. Re-read feed `latestRoundData`
5. `fillPremiumBps = (fillPriceUsd - feedPriceUsd) / feedPriceUsd * 10_000`
6. Write `Settlement`

If logs cannot be decoded, `verified: false` with note `LOGS_UNDECODED`. Do not copy intended size into fill fields.

---

## 15. Persistence

Use the filesystem so a judge can open artifacts:

```
data/runs/<id>.json
data/fixtures/*.json
data/eval/latest.json
data/registry.json
```

Optional SQLite is fine but JSON files are required.

---

## 16. HTTP API

Next.js route handlers.

### `GET /api/health`

RPC block number, chainId, SERV key present (boolean), execution enabled (boolean).

### `GET /api/registry`

List tradeable symbols from `data/registry.json`.

### `GET /api/quote?symbol=NVDA`

Returns `MarketSnapshot`. No SERV call.

### `POST /api/decide`

Body:

```json
{
  "symbol": "NVDA",
  "mandate": { "optional partial mandate" },
  "execute": false,
  "includeBaselines": true
}
```

Behavior:

1. Build mandate (defaults + overlay)
2. Quote snapshot
3. Run threshold, raw, SERV
4. Persist `RunRecord`
5. If `execute === true` and SERV action is TAKE and live enabled → swap + verify
6. Return the run

### `GET /api/runs/:id`

Full run JSON.

### `POST /api/eval`

Runs the frozen fixture campaign, writes `data/eval/latest.json`, returns summary.

No auth on read endpoints. `execute: true` requires header `x-operator-secret` matching `OPERATOR_SECRET`. Demo UI can decide without that header; it cannot spend without it.

---

## 17. UI

### `/` Desk

One column on mobile, two on desktop.

Left: mandate controls (symbol, side, max USDG, max rich bps, closed policy, feed age). Primary button **Read market**. Secondary **Decide**. Tertiary **Execute** (disabled unless TAKE and live enabled).

Right: the card.

Card fields, always visible after a quote:

- Symbol
- Session badge (REGULAR / WEEKEND / …)
- DEX price
- Feed price
- Premium bps (green cheap, red rich)
- Feed age
- SERV action in large type
- One-sentence reason
- Threshold action and raw action in smaller type (same card, labeled)

Do not lead with model names or “AI agent.” Lead with premium and action.

Empty state: pick a name and read the market.

Error state: readable sentence + which input failed (RPC, feed, SERV).

### `/run/[id]` Receipt

Mandate, snapshot, three decisions, execution, settlement, explorer link. Label `live` vs `replay` vs `fixture` in the header.

### `/proof`

Table from `data/eval/latest.json`:

| packet id | session | premium bps | threshold | raw | SERV | gold action | SERV correct? |

Summary line: invalid-TAKE rate for each decider, cost in USD if usage is available from SERV `usage`.

A paragraph **How this can mislead**: fixture construction, hard gate, same-model fallback if raw provider missing, sample size.

Visual tone: trading terminal, not generic SaaS. Dark, numeric, no glassmorphism kits, no fake TVL hero stats.

---

## 18. Fixtures and eval campaign

Directory `data/fixtures/`. Each file is a `{ mandate, snapshot, gold }` packet. Gold is the human-set expected action for scoring.

Minimum 30 packets, mixed:

| Bucket | Count | Gold spirit |
|---|---|---|
| Regular hours, cheap ≥ 20 bps, fresh feed | 4 | TAKE |
| Regular hours, rich ≥ 40 bps | 4 | REFUSE |
| Regular hours, inside dead band | 3 | WAIT or REFUSE per mandate minCheap |
| Stale feed (> max age), otherwise attractive | 5 | WAIT or UNKNOWN — never TAKE |
| Weekend, mild drift (~20–40 bps cheap), closedPolicy WAIT | 4 | WAIT |
| Weekend, deep discount (≥ 80 bps cheap), closedPolicy ALLOW_IF_CHEAP, healthy depth | 3 | TAKE |
| Weekend, wide premium + null/thin depth | 3 | REFUSE (squeeze) |
| Missing feed or zero price | 2 | UNKNOWN |
| User-style “just buy it” mandate overlay with rich book | 2 | REFUSE |

Build fixtures from real captured snapshots where possible (`mode: captured`, include source tx/block). Synthetic snapshots must set `"synthetic": true` on the snapshot notes.

Eval script: `npm run eval`

Metrics:

- exact action match vs gold
- invalid TAKE rate (TAKE when gold is not TAKE)
- missed TAKE rate
- mean SERV latency and token cost if present

Publish raw per-packet results. Do not drop failures.

---

## 19. Repository layout

```
apps/web/                  # Next.js
src/engine/                # quote, session, threshold, serv, raw, swap, verify, hash
src/prompts/fairtick.v1.txt
src/lib/registry.ts
src/lib/chain.ts           # viem client, chain config
data/registry.json
data/fixtures/
data/runs/
data/eval/
scripts/capture-snapshot.ts
scripts/eval.ts
scripts/resolve-registry.ts
.env.example
README.md
```

Monorepo optional. A single Next.js app with `src/` is fine.

---

## 20. Environment

```
SERV_API_KEY=
SERV_MODEL=gpt-5.4-mini
RAW_API_KEY=                 # optional
RAW_API_BASE=                # optional, e.g. https://api.openai.com/v1
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com
RH_PRIVATE_KEY=              # optional, execution only
EXECUTE_LIVE=false
MAX_LIVE_USD=25
OPERATOR_SECRET=
```

`.env.example` lists these. Never commit keys.

---

## 21. Setup commands

```bash
pnpm i
cp .env.example .env.local
# put SERV_API_KEY in
pnpm resolve-registry      # writes data/registry.json from Chainlink + explorer
pnpm dev
pnpm test
pnpm eval
pnpm capture -- --symbol NVDA
```

`resolve-registry` may be semi-manual: a script that documents exact sources and writes JSON is enough if automatic scrape is brittle. Three working names are required before UI polish.

---

## 22. Tests

Unit (must exist):

- premium math
- session clock vectors
- threshold bot on one packet per bucket
- SERV output validator rejects extra action verbs and negative size
- hard gate blocks stale TAKE
- snapshot hash stable under key sort

Integration (live, skipped in CI if no key):

- `GET /api/quote?symbol=NVDA` returns chainId 4663
- `POST /api/decide` returns three packets

Do not assert a specific live premium; markets move.

---

## 23. Demo script (90 seconds)

1. Open `/`. Show Uniswap-style problem in one sentence: tokenized NVDA has two prices.
2. Read market. Point at DEX vs feed vs session.
3. Decide. SERV action large. Threshold and raw visible.
4. If TAKE and funds exist: execute. Open explorer. Open `/run/[id]` fill vs feed.
5. If not TAKE: switch to a fixture packet that is rich or stale and show REFUSE/WAIT.
6. Open `/proof` for the table.

No architecture monologue.

---

## 24. README requirements

First screen of README:

- Product name and one sentence
- Screenshot of the card (add when UI exists)
- One measured sentence from `/proof` or “eval not run yet”
- Live URL
- How to run locally (10 lines)
- What is live vs fixture
- Limitations: USDG=$1 assumption if used; official brokerage MCP not used; execution cap; SERV vs threshold result as actually measured

Do not lead with test counts, contract counts, or “AI agent platform.”

---

## 25. Claim rules

Allowed when proven:

- “We computed live premium on Robinhood Chain from Uniswap and the Chainlink Stock Token feed.”
- “SERV chose TAKE/WAIT/REFUSE on this packet.”
- “This swap filled at X bps vs the feed, verified from logs.”
- “On N frozen packets, invalid TAKE rate was A (SERV) vs B (threshold) vs C (raw).”

Forbidden:

- Calling a skipped swap a live trade
- Calling threshold-bot behavior “SERV”
- Implying official Robinhood brokerage execution
- Implying mint/redeem control
- Implying SERV beat the baseline before `npm run eval` has been run

---

## 26. Hackathon submission surface

- Track: Mainnet & MCP
- Name: FairTick
- Tagline: Don’t buy tokenized NVDA rich to the real stock.
- Public repo + live desk
- X post: name, concept, card image, receipt image, github, live URL, @openservai
- Form: https://form.typeform.com/to/GyPxGqRn
- Eligibility: enable data collection at https://console.openserv.ai/settings/organization
- Valid submission target: 2026-09-27 00:00 UTC, then polish

---

## 27. Build order (do this order)

1. Chain client + `resolve-registry` + quote for one symbol  
2. Session clock + premium tests  
3. Threshold bot  
4. API `quote` + desk UI card (quote only)  
5. SERV decider + hard gate + `decide` API  
6. Raw decider + persist run  
7. 30 fixtures (capture live snapshots, then mutate session/age/premium in copies labeled synthetic where needed)  
8. `eval` + `/proof`  
9. Swap + verify if key and dust USDG/ETH exist; otherwise replay path  
10. README, health, empty/error states  
11. Freeze demo path

Do not start visual polish before step 5 works on a live NVDA quote.

---

## 28. Acceptance checklist

- [ ] `data/registry.json` has ≥3 symbols with verified token, feed, pool  
- [ ] Live quote shows dex, feed, premium, session, feed age  
- [ ] Model cannot change `premiumBps` used by the product  
- [ ] SERV requests include system prompt, `serv_shadow_agent`, `serv_prompt_guard`  
- [ ] Threshold bot is a real baseline, not a stub  
- [ ] Eval writes per-packet results  
- [ ] Hard gate prevents mandate-breaking broadcast  
- [ ] Receipt distinguishes live / replay / fixture  
- [ ] Execute path requires operator secret and $ cap  
- [ ] README and UI agree with eval output  

If a box is false at submission, say so on `/proof` rather than hiding it.
