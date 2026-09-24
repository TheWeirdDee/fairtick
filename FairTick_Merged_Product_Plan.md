# FairTick — merged product and delivery plan

Planning baseline: 24 September 2026. Companion to FairTick_PRD.md; this is a proposed implementation plan, not a claim that the product is implemented or validated. Where this plan differs from the original PRD, reconcile the PRD before implementation. The original document remains available for comparison.

## 1. Product decision

FairTick checks a stock-token purchase against the user's instructions, executes when permitted, and can keep managing the unfilled remainder until a deadline.

One product, two modes:

| Mode | User promise | End condition |
|---|---|---|
| Buy now | Check the current executable price and make one approved purchase | One attempt settles, fails, or is declined |
| Work my order | Keep trying to spend up to the approved budget within the approved conditions | Budget filled, user cancels, deadline expires, or intervention is required |

Both modes use the same reference checks, quote engine, deterministic validator, swap executor, and receipt verifier. Managed orders add persistence, scheduling, partial-fill accounting, and recovery. A single-shot purchase does not silently become an ongoing order.

Primary user: an existing stock-token buyer who has already chosen an asset and wants execution within explicit limits. FairTick does not select investments or promise returns.

Product distinction to test: a usable combination of reference-aware execution, partial completion, bounded recovery, and independently checkable receipts. Ordinary limit orders and algorithmic execution already exist; ongoing checking alone is not a novelty claim.

## 2. What stays, changes, and is deferred

| Keep from original | Correct | Add |
|---|---|---|
| DEX and official reference comparison | Evaluate actual-size executable quotes, not just pool spot | Persistent orders and remaining-budget accounting |
| Freshness and session checks | Enforce every hard rule in code and transaction bounds | Background worker with bounded retries |
| TAKE / WAIT / REFUSE / UNKNOWN decisions | Separate decision action from order lifecycle | Partial execution and cancellation |
| SERV reasoning and structured output | Fair same-prompt evaluation; no promised superiority | Tool planning and recovery evaluation |
| Real swaps and public receipts | Pin reference timing; verify wallet-relevant amounts | Aggregate receipt across all child fills |

First executable release: one verified stock token, BUY only, USDG input, one routing implementation, one operator-controlled funded wallet. Registry architecture permits more names, but three names are not a prerequisite for proving execution. Choose V3 or V4 after liquidity discovery; do not implement both by default.

Defer SELL, multi-chain support, brokerage MCP, mint/redeem, portfolio management, news-based predictions, custom tokens, complex routing, and a public multi-user custody service. Price checks remain available without execution permission.

## 3. User journey

1. Choose asset and either Buy now or Work my order.
2. Enter budget, price limit, deadline where applicable, partial-fill permission, and permitted market sessions. Offer simple form controls; natural-language entry is optional assistance, not a prerequisite.
3. Read a plain-language confirmation: asset, wallet, total budget, maximum price/premium, expiry, and whether partial fills are permitted.
4. Approve the immutable mandate. Editing limits requires a new version and explicit reauthorization; the model cannot change them.
5. See current conditions: actual quoted order cost, reference value and timestamp, allowed price, and the next action.
6. For managed orders, the backend continues even when the tab is closed. The page shows amount spent, tokens received, budget available, next check, and any pending transaction.
7. Cancel future execution at any time. A transaction already broadcast may still settle; show that distinction immediately.
8. Open the final receipt: each fill, aggregate amounts, remaining money, reference comparisons, and completion or stopping reason.

Illustrative scenario only: a 100 USDG order buys 40 USDG within limits, waits when the reference becomes unusable, and later buys another permitted amount. No particular partial fill or favorable market movement is guaranteed. The live demonstration can use a much smaller budget.

## 4. SERV and deterministic responsibilities

| SERV may do | Code must do |
|---|---|
| Interpret optional natural-language instructions and surface ambiguity | Validate all fields and require confirmation |
| Choose the next tool from a finite permitted set | Determine legal transitions and tool permissions |
| Request a smaller quote after seeing why a larger quote failed | Compute candidate amounts, quotes, and limits |
| Choose a permitted retry or escalation after an error | Apply retry bounds and prevent duplicate broadcasts |
| Explain a pause, partial fill, or unresolved condition using evidence IDs | Compute balances, prices, sessions, receipts, and remaining budget |

Permitted model proposals: REQUEST_QUOTE, PROPOSE_EXECUTION, WAIT, REQUEST_CLARIFICATION, ESCALATE. Cancellation and changes to user limits remain user actions. A model proposal cannot directly sign, approve, transfer, change a recipient, or alter a budget.

SERV receives the confirmed mandate, latest evidence packet, relevant order history, remaining budget, and available permitted actions. It produces structured output with evidence references. Invalid output, timeout, or unsupported proposal means no new transaction. The worker applies a documented bounded retry or moves the order to Needs attention.

The execution kernel must be independently correct without the model. The hypothesis to test is that SERV improves instruction interpretation or multi-step recovery, not that it improves arithmetic or predicts fair value.

## 5. Mandate and financial invariants

Required mandate fields:

- Unique order ID and version; mode; owner; fixed signer and recipient; chain; allowlisted token and route.
- Budget in USDG base units; maximum per-fill amount; partial-fill permission; minimum viable fill.
- Absolute maximum token price in USDG and/or maximum premium relative to the specified usable reference. If both are present, both apply; display the effective stricter bound.
- Maximum feed age, quote age and slippage; reference validity policy; allowed sessions.
- Expiry; maximum fill count; maximum execution attempts; maximum cumulative gas expenditure and minimum gas reserve.
- Confirmation time and mandate hash.

Use integer base units and fixed-point arithmetic for execution. A budget is a ceiling, not a requirement to spend every unit. Gas is paid in ETH and is shown as a separately bounded expense. Missing USD conversions must not silently become exact USD values.

For every order:

    settledSpend + reservedPendingSpend <= approvedBudget

Amounts reserved for pending transactions cannot be used by another child fill. Persist the reservation and fill intent atomically before broadcasting. Serialize orders using the same signer or maintain an equivalent wallet-level nonce and balance reservation mechanism.

For a BUY, transaction minimum output is at least the stricter of:

1. Output permitted by the slippage constraint on the current actual-size quote.
2. Output required by the mandate's effective maximum execution price, conservatively rounded.

The executor derives this value; it never trusts model-produced limits. Recompute all checks immediately before signing. A pre-broadcast oracle comparison does not guarantee a moving oracle bound throughout inclusion; v1 commits to a concrete reference round and price bound with short quote validity. State this boundary in the receipt. Atomic live-oracle enforcement would require a separately specified contract and is deferred.

When unknown depth cannot establish safe sizing, use validated actual-size quotes and explicit price-impact bounds. Unknown depth is not proof of a squeeze. No full-budget fallback solely because depth is null.

## 6. Order lifecycle and decision semantics

Lifecycle states: DRAFT, ACTIVE, WAITING, SUBMITTING, PENDING, NEEDS_ATTENTION, COMPLETED, CANCELLED, EXPIRED.

- Confirmation moves DRAFT to ACTIVE.
- Each worker cycle locks the order, reconciles any pending transaction, checks cancellation/expiry, and only then gathers new evidence.
- A valid execution proposal with passing deterministic checks moves through SUBMITTING and PENDING.
- After a confirmed fill, deduct actual spend and release its reservation. Return to ACTIVE if a viable remainder is still authorized.
- Temporary conditions produce WAITING with a bounded next-check time and reason.
- Ambiguous pending transactions must be reconciled; never resubmit as a new purchase merely because an RPC call timed out.
- Repeated failures or missing authorization produce NEEDS_ATTENTION.
- COMPLETED means the budget was spent to the configured, disclosed dust tolerance. Otherwise report partial completion or no fills with CANCELLED, EXPIRED, or NEEDS_ATTENTION.

Keep the original decision vocabulary on each evidence packet:

| Decision | Meaning | Managed-order behavior |
|---|---|---|
| TAKE | A permitted candidate execution exists | Validate and execute within existing authorization |
| WAIT | A temporary condition prevents execution | Schedule another bounded check |
| REFUSE | This candidate/request violates a hard rule | Reject candidate; keep working only if the confirmed mandate remains valid |
| UNKNOWN | Evidence is missing or unusable | No trade; retry or escalate under policy |

REFUSE does not automatically destroy a valid order just because the current price is rich. Distinguish candidate rejection from permanent order failure.

Expiry and cancellation prevent new broadcasts. They cannot undo an already included or pending transaction. Continue reconciliation after either event, retain reservations until resolved, then report the final outcome accurately.

## 7. Worker and data architecture

Implementation shape: Next.js interface/API; long-running TypeScript worker; transactional durable database; viem quote/execution adapters; SERV client. Prefer Postgres if deployment has separate web and worker processes. Do not rely on browser timers, in-memory locks, or an ephemeral server filesystem.

Persist orders, mandate versions, snapshots, decisions, fill intents, transactions, append-only events, and receipts. Export readable JSON artifacts for reproducibility.

Evidence packet includes chain ID, block number/hash/time, asset/feed/router/pool identifiers, reference round/value/update time, actual-size quote and amount, token decimals, multiplier/pause observations, session classification, and source status. Missing values use explicit unavailable states rather than NaN or fictional zeros.

The scheduler chooses conservative intervals appropriate to feed updates and RPC limits. Start with a configurable 60-second managed-order check interval, exponential backoff for transient failures, and a hard attempt cap; tune after measurement. Refresh deterministic data before deciding whether a new model call is needed. Stable price rejection can be rechecked without paid inference. Every decision records whether its origin was code or SERV.

Use database locks/leases and unique fill-intent keys. Persist signed transaction identity before or consistently with broadcast; on crash, reconcile by known hash/nonce before creating another intent. Expired worker leases do not authorize double spending.

Authenticate all spending and order mutations. Scope private orders to their owner. Protect model-consuming and evaluation endpoints with rate and cost limits. Public receipt views expose selected evidence, not credentials or private instructions.

## 8. Market and reference policy

Treat the official feed as a time-stamped reference, not guaranteed current fair value. Verify each live asset/feed/pool mapping and contract bytecode before use. Document any USDG parity assumption. Prefer native USDG-denominated user bounds when USD accuracy is unproven.

Check non-positive/future/invalid timestamps, quote age, feed age, oracle pause, scheduled multiplier transitions, token/route validity, and supported network-health signals. Where sequencer status is available, include its documented grace policy. Unknown required state blocks execution.

Do not apply uiMultiplier twice to a multiplier-adjusted feed. Compute balances in token units; display share-equivalent exposure separately only when justified.

Cash-market session, reference availability, and onchain tradability are distinct facts. Include verified holidays and early closes; missing calendar coverage is unknown, not permission to declare the market open. Revalidate per-asset metadata schemas against real responses.

The initial managed-order policy waits when the reference is stale or paused. Weekend trading remains visible but is not the promised successful demo. Do not manufacture a fresh weekend reference or present a discount to a stale close as a proven bargain.

## 9. Receipt and verification

Each fill receipt contains mandate hash, evidence hash, decision source/model/prompt version, intent ID, transaction hash, success status, inclusion block, decoded input/output, wallet-relevant transfers, fees/gas, decision reference round, and a reference read pinned to a specified block where available.

Verify receipt success and allowlisted event provenance; do not equate an HTTP success response with settlement. Multi-hop or unusual tokens require correct route-level accounting; remain single-route initially.

Report separately:

- Settlement verified: amounts were reconstructed from chain evidence.
- Mandate compliance verified: amounts and committed execution bounds match the approved order.
- Reference comparison: which round and block were used, including staleness.

Aggregate receipt sums all confirmed child fills, lists pending items, and shows remaining budget. A pending fill prevents a false final accounting. Label live, recorded replay, testnet, and synthetic demonstrations distinctly.

## 10. Evaluation and customer evidence

Two independent campaigns:

1. Deterministic execution safety: actual-quote bounds, staleness, pause/session rules, budget conservation, duplicate clicks/jobs, worker restarts, pending reconciliation, cancel/expiry races, and receipt reconstruction. Required invariants must hold regardless of SERV output.
2. SERV contribution: instruction interpretation and multi-step tool/recovery behavior. Use identical full prompts, model/settings, schemas and inputs for comparable model paths. A no-shadow run is a shadow ablation unless genuine raw mode is confirmed.

Freeze at least 30 varied scenarios before scoring: normal purchases, partial fills, conflicting instructions, missing data, stale reference, failed quotes, transient RPC errors, pending transactions, expiry, cancellation, and hostile text. Label captured and synthetic inputs. Permit sets of valid next actions where several plans are reasonable. Safety labels derive from code; ambiguous usability labels require an explicit rubric.

Report task completion, unauthorized-action proposals, post-gate violations, unnecessary abstentions, tool-argument validity, human corrections, recovery success, cost, and p50/p95 latency. Pre-gate and post-gate results remain separate. Include a competent rules-based execution baseline. No claim of outperforming zero violations; no profit claim from fixtures.

Customer test: seek feedback from 3–5 actual token traders or agent/application builders. Ask about their last difficult order, current tools, whether the proposed workflow helps, and what they would pay or integrate. Record actual responses; do not invent validation. A subscription or execution API is a hypothesis, not established revenue. Messaging anyone requires separate authorization.

## 11. Build gates and schedule

Dates are delivery targets, not evidence of completed work. Official deadline from the reviewed event page: 28 September 2026 at 00:00 UTC, equivalent to 01:00 in Nigeria. Internal submission target: 27 September at 18:00 UTC / 19:00 Nigeria.

| Gate | Deliverable | Exit evidence |
|---|---|---|
| A: feasibility, first 2–3 focused hours | Resolve one live route; read usable feed; obtain actual-size quote; simulate; make one SERV structured request | Addresses, block/round, real quote, simulation result, request result; no fabricated substitutes |
| B: first executable path, Sep 24–25 | Buy-now mode, full deterministic validator, receipt | One explicitly authorized small real purchase, reproducible receipt, bound checks pass |
| C: managed order, Sep 25–26 | Durable state, worker, remainder accounting, cancellation, expiry, recovery | Continues after closing browser; restart/duplicate-job tests do not duplicate spend |
| D: product and evidence, Sep 26 | Desk, order page, aggregate receipt, frozen evaluation | Functional end-to-end flow; fair raw results; clearly labeled scenarios |
| E: submission, Sep 27 | Demo, README, public links, X post and form preparation | Submission checklist complete; final public writes require user authorization when not already given |

Gate A failure: report the exact unresolved dependency and evidence. Investigate another verified token or RPC route within a fixed short timebox. A labeled replay may support a demo but does not satisfy live-execution readiness.

Prioritize a regular-session live capture on Thursday or Friday where possible. Do not assume a valid Sunday purchase. Do not loosen user limits to force a successful trade for the video.

If time tightens, cut extra assets, text input, extra routes, and elaborate charts first. Keep complete spending controls, durable managed execution, honest receipts, and clear labels. Never ship a cosmetic managed mode that stops when the browser closes.

## 12. Demo and go/no-go

90-second sequence:

1. Show one clear purchase instruction and its confirmed limits.
2. Show actual quote versus allowed bound and reference age.
3. Show a real authorized fill and tokens received.
4. Show the managed order's remainder and next action. Compress elapsed time only in a labeled recorded timeline; do not stage market changes as live.
5. Show final/partial outcome and a receipt that a judge can inspect.
6. Briefly show measured SERV results and limitations.

Continue to a full submission if the route works, the order lifecycle is reliable, the product is usable, and SERV has a substantive measured role or an honestly explained limitation. Do not claim a winning concept merely because a swap succeeds.

If useful behavior reduces entirely to a threshold loop and SERV adds only decorative text, stop expanding and reassess sponsor fit. Keep the implementation evidence; do not weaken the baseline or invent complications to manufacture model value.

## 13. Submission and claim checklist

- Working desk, order page, receipt page, and proof page.
- Genuine SERV integration; eligible organization data-collection setting confirmed by owner.
- Mainnet execution accurately distinguished from simulations/replays.
- No assertion of brokerage MCP usage, guaranteed fair value, squeeze detection, or guaranteed completion.
- One reproducible successful fill; bounded partial/expired outcomes are honest product behavior.
- Public repo and README with setup, operator-only boundary, and limitations.
- X draft includes name, concept, images, relevant links and @openservai; form follows posting.
- No secrets or private wallet credentials in artifacts, model inputs, or public pages.
- Public submission and any real-money execution are separate actions from approving this plan.

## 14. Evidence basis and remaining unknowns

This plan builds on documentation reviewed in the preceding research, not newly measured chain behavior. Direct chain/API access in that research did not yield usable live responses; no execution readiness is claimed here.

Relevant references:

- Event and submission rules: https://www.openserv.ai/hackathon
- SERV task division and evaluation guidance: https://docs.openserv.ai/serv-reasoning/day-one
- SERV feature configuration: https://docs.openserv.ai/serv-reasoning/tools
- SERV SDK integration: https://docs.openserv.ai/serv-reasoning/sdk-integration
- Robinhood token behavior: https://docs.robinhood.com/chain/stock-tokens/
- Robinhood asset metadata: https://docs.robinhood.com/chain/stock-token-apis/
- Chainlink reference behavior: https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- Uniswap deployment registry: https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments
- Uniswap actual-size quoting: https://developers.uniswap.org/docs/sdks/v3/guides/swapping/quoting
- Closest researched comparison: https://robinhoodrpc.io/docs/equities/price-reconciliation

Unresolved: live route/liquidity, credentials and funded wallet, exact deployment environment, measured SERV benefit and cost, customer demand, and production-grade multi-user signing. Gate A resolves the execution dependencies; the evaluation and user feedback address the product hypotheses.
