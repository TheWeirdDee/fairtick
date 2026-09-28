# Current release findings - 2026-09-27

This section supersedes the historical development log below. Historical timestamps are retained and are not current readiness claims.

- Real SERV integration is evidenced in `data/evidence/serv-path-1790371357185.json`: HTTP 200, validated proposal, 10,022 ms, 1,712 tokens, explicitly synthetic market inputs. Dollar cost and organization data-collection eligibility are unverified. No new paid inference was performed in this continuation.
- Testnet signing is implemented and local mock execution is verified. Mainnet signing remains disabled. Public settlement remains BLOCKED: current wallet has 0 ETH, nonce 0 and no code at the six predicted deployment addresses.
- `data/evidence/testnet-release-probe.json` observed the documented public endpoint at 2026-09-27T17:30:05Z. Head 125286479, finalized block 125277579; finalized hash matched the public reference endpoint and canonical testnet gateway bytecode was present. This is network identity evidence, not a transaction receipt.
- The previous mainnet-address-on-testnet probe does not establish that testnet assets or routes do not exist. Current dependency research is in DEPENDENCIES.md. WETH is officially documented; TSLA and PLTR candidates have code and explorer metadata but current official faucet identity was not independently confirmed. No suitable fully verified route/reference combination was found in the inspected sources.
- Sender balance deltas are not accepted as fee evidence. Local EVM uses receipt gas times effective gas price. The public-testnet Nitro adapter now verifies the transaction total from `gasUsed x effectiveGasPrice` only when `gasUsedForL1` is present and is a valid subset; it never adds that subset again. Existing historical balance-delta claims below are withdrawn as verification evidence.

**Public purchase reconciliation, September 28, 2026.** Transaction `0x6ff3ed3ac70b618b8ae7f244025a4a7177f2b4cea00b3ae5c8645c083be0ce16` has `gasUsed=152274`, `effectiveGasPrice=10000000`, and `gasUsedForL1=15244`. Total actual fee is therefore **1,522,740,000,000 wei**. The parent posting subset is 152,440,000,000 wei and the child compute subset is 1,370,300,000,000 wei; their sum equals the total and the explorer display. The application reverified the existing finalized receipt without creating, reserving, signing, or broadcasting another purchase and without another SERV request. Token settlement, fee verification, and all recorded mandate checks pass. Evidence: `data/evidence/testnet-reconciliation-2026-09-28T09-45-09-802Z.json` and `public/evidence/public-testnet-status.json`.
- Encrypted signed bytes are persisted with transaction identity before submission. Recovery retries the same hash, not a new fill. Stale unsigned reservations remain for review. Cancellation/expiry suppress further sends while retaining reconciliation.
- Included, finalized, token settlement, fee verification and mandate compliance are distinct findings. Inclusion reference caches are keyed by block hash and retry missing reads. Previous finality/pruning timings describe endpoint observations only.
- Access now uses expiring HttpOnly sessions, not sessionStorage of the operator code. Public docs, tour and sanitized recorded evidence are available. RELEASE-CHECKLIST.md records final browser/build status.

---

# Historical development observations (superseded where noted above)

# FairTick — Data Contract (Gate A verification record)

## Testnet mock-market demo, 2026-09-26 (current, separate from mainnet)

A separate configuration (`FAIRTICK_NETWORK=testnet`) runs the same order engine, validator, SERV planner, worker and receipt verifier on Robinhood Chain testnet **46630** over labeled **mock** contracts. Mainnet configuration, registry, sender, database and the "signing disabled" rule are unchanged; no code path signs for chain 4663.

**Robinhood testnet, verified read-only** (`npm run testnet:probe`; `data/evidence/testnet-probe-2026-09-26T06-12-50-195Z.json`): `eth_chainId` 46630; gas price 10,000,000 wei; latest block ~5 s behind wall clock, ~162 ms blocks (explorer `https://explorer.testnet.chain.robinhood.com`, Blockscout); `finalized` trails latest by 9,313 blocks / 1,630 s; historical state available at latest−5,000 but **pruned at latest−8,000** (so a receipt's fee must be measured at first sighting, not at finality — implemented). The Arbitrum NodeInterface fee path works (L1 part 2,292 L2 gas on a probe call). Of the mainnet contracts, only Multicall3 has code on testnet; USDG, Uniswap V3 factory/router/quoter have none. The official asset registry lists no testnet deployments; no Chainlink testnet feed directory exists. There is therefore **no official testnet stock token, pool or price feed** — the demo deploys its own.

| Dependency | Real or mocked | Notes |
| --- | --- | --- |
| Chain 46630, RPC, blocks, finality, gas, fees | **Real** (Robinhood testnet) | Faucet test ETH has no value |
| Quote token `mUSDG`, stock token `mNVDA` | **Mock** (`DemoToken`) | Owner-minted, valueless; not USDG, not a Robinhood stock token |
| Reference price | **Mock**, operator-set (`DemoAggregator`, AggregatorV3 reads) | Not Chainlink, not market data; refreshed by the operator |
| Pool / liquidity | **Mock, controlled** (`DemoPool`, constant product, 0.05% fee, seeded 225,000 mUSDG : 1,000 mNVDA) | Emits Uniswap V3-shaped `Swap` events so the unchanged receipt verifier applies |
| Router / quoter | **Mock** (`DemoRouter` multicall + exactInputSingle; `DemoQuoter`) | Same calldata FairTick prepares for SwapRouter02 |
| Trading halt, corporate actions | **Not applicable** (mock asset) | Recorded as `false` with explicit `…_NOT_APPLICABLE_MOCK_ASSET` notes, never as an official observation |
| Session | Real US calendar | Demo mandates choose `closedPolicy: ALLOW`; the validator is unchanged |
| SERV | **Real** authenticated inference | Told the data is a testnet mock |
| Decision labels, receipts, UI | Labeled `… TESTNET MOCK MARKET DATA` / `LOCAL DEVNET MOCK`; receipts carry `environment.marketData = "TESTNET_MOCK"` and a note | |

| Area | Status | Evidence |
| --- | --- | --- |
| Demo contracts | Written and compiled (solc 0.8.37, paris, optimizer 200); source sha256 `3dc06b4f…4cbaf3` | `contracts/testnet/FairTickDemo.sol`, `contracts/testnet/artifacts/FairTickDemo.json` |
| Separate testnet wallet | Generated into gitignored `.env.local` (`RH_TESTNET_PRIVATE_KEY`, `RH_TESTNET_SENDER_ADDRESS`); differs from the mainnet key and sender. Public address `0x2a432DbE5Db0A6b2Aa0535e6592493679A26c9a0`; balance **0** at 06:12Z | `npm run testnet:wallet` |
| Deployment plan against the real testnet | **Dry run only.** 13 transactions, nonces 0–12, predicted addresses, live `eth_estimateGas` for the six deployments (272,540–794,996 gas); conservative cost bound 0.000118 ETH | `data/testnet/robinhood_testnet-deploy-plan.json` |
| End to end on a **local devnet** (anvil 1.8.3, chain id 46630, loopback) | **Passed.** HTTP confirmation → worker checks → **real SERV** `PROPOSE_EXECUTION` (`gpt-5.4-mini-2026-03-17`, HTTP 200, 10.4 s, response `chatcmpl-ESFt0McqQv0EvipIWebBmbEFfpOlT`) → deterministic revalidation → reservation → identity persisted → signed and broadcast → finalized → receipt `SETTLED`, settlement, mandate compliance and gas cost verified (fee by sender balance delta); 25 mUSDG in, 0.111043… mNVDA out, matched by independent balance reads. Repeated after the final worker change: same result (response `chatcmpl-ESG28TwL1oXgZcjm4tAioEv35Ol7i`, 8.6 s) | `data/evidence/testnet-local-e2e-2026-09-26T06-10-26-382Z.json`, `…06-18-52-604Z.json` |
| Onchain testnet evidence | **None yet.** Nothing has been broadcast to Robinhood testnet; the wallet is unfunded | — |
| Tests | 186/186 (`npm test`, 17 new testnet tests: network selection, key separation, registry guard, database binding, worker execution order, broadcast/sign failure, nonce change during inference, mainnet route never executed, signing output); TypeScript clean; production build clean; mainnet HTTP + worker smoke still passes (`data/evidence/order-smoke-1790403562564.json`) | 2026-09-26 |
| Script refusals checked | `FAIRTICK_NETWORK=mainnet` → refused; testnet RPC set to the mainnet URL → `TESTNET_RPC_EQUALS_MAINNET_RPC`; URL variant → live check `TESTNET_RPC_CHAIN_MISMATCH:4663` | 2026-09-26 |

The local-devnet run is a simulation of the workflow, not chain evidence: anvil is not Arbitrum (no L1 posting component; its base fee decays on empty blocks), and its "finalized" tag trails the head by two blocks instead of ~27 minutes.

## Status, 2026-09-25 21:25 UTC (mainnet; unchanged by the testnet work)

One line per area: what is actually true right now, not what is planned or partially built. "Verified" means measured with reproducible evidence in this file or `data/evidence/`; anything else is not claimed.

| Area | Status | Evidence |
| --- | --- | --- |
| Code implemented | Domain types, quote adapter, session clock, threshold display, execution validator, `prepareBuy` calldata, receipt verifier, durable SQLite store, worker, desk UI/API, SERV planner **connected to the worker**, **evidence provenance enforced in the shared validator** | This repository; see "SERV planning in the order worker" and "Evidence provenance" below |
| Synthetic tests passed | 169/169 (`npm test`), TypeScript clean, production build clean; HTTP + independent-worker smoke passed at ~20:18Z (before the provenance change) | Run 2026-09-25 ~21:20Z; synthetic fixtures, real temporary SQLite; mutation checks confirmed the provenance and cancellation tests fail when their guards are removed |
| Reference feed suitability | **A, conditionally** — the Standard proxies can meet the unchanged 900s rule only in identifiable windows after a round update (NVDA 21.8%, SPY 2.8% of 60s regular-session checks); none before the Sep 28 00:00 UTC deadline under the default regular-session policy | "Reference-feed suitability" below; `data/evidence/feed-history-1790370536648.json` |
| SERV wired into the real worker | **Yes** — called only when deterministic code has already found a permitted candidate; proposals re-checked and revalidated before any state change | `src/orders/worker.ts`, `src/orders/store.ts` `applyPlan`; `test/planning.test.ts` (24 application-path tests) |
| Worker SERV path exercised with the real planner | **Yes, authenticated, on synthetic market data** — latest run labeled `REAL SERV CALL ON SYNTHETIC MARKET DATA`, outcome `SIMULATION_PREVIEW`, `liveExecutable: false`, 0 reserved, 0 intents (response `chatcmpl-ES7fFOp0QZxjA3GpdBImdjsvUpgCb`). The earlier 20:44Z run predates provenance labels and was stored as `EXECUTION_DISABLED_PREVIEW`; its proposal was appropriate to the prompt it received (see "SERV behavior on synthetic evidence") | `data/evidence/serv-path-1790371357185.json`; earlier `serv-path-1790369092408.json`, `serv-path-1790367324386.json` |
| Live reads verified | Yes — chain ID, block, bytecode, NVDA/SPY token/feed/pool, executable quotes, oracle pause/multiplier, corporate actions, halt reads; live worker ran the new prerequisite/fee adapter in the smoke test | `npm run verify-dependencies`, `npm run probe-candidate` (12:51–12:53Z); smoke at ~20:18Z |
| Configured-wallet simulation verified | **Checked, FAILED** — configured sender holds 0 USDG, 0 router allowance, 0 ETH; simulation reverts (`insufficientBalance` and `insufficientAllowance` both true, no state override). A blocker, not permission to fund or approve | `data/evidence/gate-a-2026-09-25T20-46-03-695Z.json` (contains the public sender address — do not publish) |
| Authenticated SERV verified | **Yes (integration)** — model `gpt-5.4-mini` → returned `gpt-5.4-mini-2026-03-17`; response IDs `chatcmpl-ES74hL0ww5SEYtVsQKZmvMUzLAu4C` (worker path, 18.8s, 1,688 tokens) and `chatcmpl-ES75qEKh1NI3Ae1ROEHg8Cthmz4oc` (standalone diagnostic on real stale evidence → `ESCALATE`); no `x-request-id` header was returned. Whether `serv_shadow_agent`/`serv_prompt_guard` ran is not observable in the response | serv-path and gate-a evidence files above |
| Total fee estimate verified live | **No** — sender-specific `eth_estimateGas` reverts `STF` (no USDG balance/allowance), so the total and upper bound stay `null`. Measured: gas price 35,836,000 wei; L1 part 817 L2 gas × 35,896,000 = 29,327,032,000 wei (L1 base fee estimate 4,345,918, down from 7,751,620 at 20:23Z) | one-off read-only run of `estimateTransactionFee`, 2026-09-25T20:47:26Z |
| Live settlement verified | **No** — no transaction has been broadcast; signing is hard-disabled regardless of `EXECUTE_LIVE` | No code path signs, approves or broadcasts |
| Deployment verified | **No** — local only, single host, no OS service or public deployment installed | `OPERATIONS.md` |

**Gate A is incomplete.** An authenticated SERV response now exists (integration only, on synthetic evidence). Still missing: a passing configured-sender simulation (the wallet is unfunded and has no router allowance) and a usable (fresh) reference. Feed rounds observed, unchanged 900s cap:

| Asset / feed | Round → updatedAt (observed at) | Advanced? |
| --- | --- | --- |
| NVDA `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | …2715 → 2026-09-24T16:41:56Z (seen 09-24 19:56Z through 09-25 04:14Z); …2716 → 06:22:16Z (09:44Z, 12:51Z); …2722 → 19:56:05Z (20:18Z; again 20:45:50Z at 2,985s old, aggregator round 1106) | Yes: once overnight, six rounds during the 09-25 session; none between 20:18Z and 20:45Z |
| SPY `0x319724394D3A0e3669269846abE664Cd621f9f6A` | …1761 → 2026-09-25T04:04:29Z (04:08Z, 12:53Z); …1762 → 16:03:00Z (20:46:49Z, 17,030s old) | Yes: once between 12:53Z and 20:46Z; none in the 8h45m before that |

Freshness at each saved observation (recorded age vs the unchanged 900s limit):

| Asset | Observations and recorded age | Fresh? |
| --- | --- | --- |
| NVDA | 09-24 19:56Z 11,656s · 20:00Z 11,884s · 20:02Z 12,025s · 09-25 04:14Z 41,526s · 09:44Z 12,114s · 12:51Z 23,376s · 20:18Z 1,323s · 20:45Z 2,985s | Never (closest: 1,323s) |
| SPY | 09-25 **04:08:35Z 250s** · 12:53Z 31,715s · 20:46Z 17,030s | **Once**, at 04:08:35Z (00:08 ET, overnight session) |

Both feeds update when the price moves ≥0.5% or after a 24h heartbeat, and publish nothing while the market is closed; see "Reference-feed suitability". An old timestamp is expected behavior for these feeds, not proof of a fault. When either will next update is unknown and waiting is not assumed to resolve it. Neither asset was promoted; the registry, route and all limits are unchanged.

### Corrections to earlier wording in this file

Two phrases used earlier in this document (preserved below, unedited, for history) read as more conclusive than the evidence actually supports:

- **"Pool token balances" was described as "depth."** Section A below says the NVDA/USDG pool "holds ~$2.8M of USDG-side depth" based on a raw `balanceOf` read of the pool contract. A pool's total token balance is not the same thing as the size actually executable near the current price: Uniswap V3 liquidity is concentrated across tick ranges, so the size that can trade before meaningfully moving price can be much smaller than the pool's total balance. The actual-size Quoter calls in section C are the correct measure of executable size at a given input; the balance figures were only ever used to *rank* candidate pools against each other (correctly, since the ranking held by roughly two orders of magnitude), not to claim a specific executable-depth number. No number in this file has been corrected as a result — the ranking conclusion (which pool to use) is unaffected — but readers should not quote "$2.8M depth" as a tradable-size claim.
- **"Blocked on RH_PRIVATE_KEY" for read-only checks.** Earlier text (and an earlier README) described wallet balance/allowance/simulation checks as blocked on a missing private key. That is imprecise: those are read-only calls (`balanceOf`, `allowance`, and a diagnostic `eth_call` simulation) that only need a **public** `RH_SENDER_ADDRESS`. A private key is relevant only to a future signing release, which is separately disabled in this build regardless. The current implementation (`scripts/verify-dependencies.ts`, `src/orders/worker.ts`) already reflects the corrected version; this note exists so the historical sections below aren't mistaken for the current requirement.
- **The earlier fee formula double-counted and mixed units.** "Live-adapter gap closure" below (written earlier on 2026-09-25) computed the total fee as buffered `eth_estimateGas` × gas price **plus** an L1 fee of `gasEstimateForL1 × l1BaseFeeEstimate`. Both parts were wrong per Arbitrum's documentation and source: `eth_estimateGas` already includes the L1 posting buffer, so adding it again double-counts; and `gasEstimateForL1` is in L2 gas units priced at the L2 `baseFee`, not the L1 base fee estimate. It gave the right number this morning only because the L1 price happened to read zero then, and it also turned an *unavailable* L1 read into zero. Fixed and tested — see "Transaction fee estimation". The two check names in that section (`contractsVerified`, `networkHealthy`) overclaimed and are renamed.
- **"This chain does not charge an L1 posting fee" was an overgeneralization.** Earlier text inferred from zero readings that the chain's data-availability mode charges no per-transaction L1 calldata fee. A later read the same day found a nonzero L1 price (7,751,620 wei L1 base fee; 1,383 L2 gas of L1 cost for the real swap calldata). The zeros were a moment in a dynamic price, not a property of the chain.
- **"Neither feed was fresh at any check today" was wrong.** It appeared in the previous status summary and in a chat report. The saved SPY observation at 2026-09-25T04:08:35Z (`candidate-SPY-1790309322586.json`) recorded a 250s age, within the 900s limit, and that file's own `usable` flag was `true`. The corrected per-observation table is in the status section above. The historical conclusion "neither asset passes today" in "Fresh asset investigation" below is kept unedited; it is accurate only for the ~12:5x observations it summarizes.
- **SERV's synthetic-run proposal was described as a failure to "hold back".** The prompt it received never asked it to decline synthetic evidence or to simulate. `PROPOSE_EXECUTION` on a code-permitted candidate followed the prompt, and its explanation did not claim a live observation. See "SERV behavior on synthetic evidence".

---

## Reference-feed suitability, 2026-09-25

Scope: the exact NVDA (`0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`) and SPY (`0x319724394D3A0e3669269846abE664Cd621f9f6A`) proxies the quote adapter reads. Reproduce with `npm run probe-feed-history` (read-only, one block). Evidence: `data/evidence/feed-history-1790370536648.json` (block 72537272).

**Documented facts** (quoted from Chainlink sources):

- *Directory entries* (`feeds-robinhood-mainnet.json`): "Robinhood NVDA / USD" and "Robinhood SPY / USD"; `feedCategory: custom`; `docs.productType: Price`, `productSubType: calculatedPrice`, `productTypeCode: primaryTokenizedPrice`; `marketHours: us_equities_24/5`; `svrDisplayLabel: Shared SVR`. `threshold 0.5` and `heartbeat 86400` are rendered by docs.chain.link as **Deviation 0.5%** and **Heartbeat 86400s** (`Tables.tsx`, smartcontractkit/documentation).
- *Consumption endpoint*: the docs table labels `proxyAddress` as **"Standard Proxy"** and `secondaryProxyAddress` as the **"Shared SVR Proxy"** (same source). Our registry reads the **Standard** proxy. SVR is "purpose-built for recapturing non-toxic liquidation-related OEV"; "SVR introduces a small, configurable delay to allow for the MEV-Share auction"; "Protocols can also opt out at any time by reading from the Standard proxy that complements every SVR proxy" (docs.chain.link/data-feeds/svr-feeds). The Standard proxy is therefore the appropriate endpoint for a non-liquidation consumer.
- *Update behavior*: tokenized equity feeds "do not publish updates, including heartbeat updates, while markets are closed" and report the last value with the timestamp of the final pre-close update. Overnight data comes from "fewer providers" and may surface atypical values. Feeds "do not explicitly flag" holidays, halts or closures (docs.chain.link/data-feeds/tokenized-equity-feeds). The Robinhood page: "configured as 24/5 tokenized equity feeds (regular, pre-market, post-market, and overnight sessions)"; "Integrators should read `updatedAt` and implement staleness bounds appropriate to their use case".
- *Hours*: "US_Equities_24/5: 24 hours a day, 5 days a week: 18:00 ET Sunday to 17:00 ET Friday" (docs.chain.link/data-feeds/selecting-data-feeds).
- *Custom category*: "can differ materially from standard market price feeds in sourcing, methodology, update behavior, and risk profile" (same page).

**Observed on-chain** (block 72533570 and 72537272, measured, not inferred):

- Both proxies of each feed resolve to the same `DualAggregator 1.0.0` (NVDA `0xC9d16E4f…`, SPY `0x78BCB218…`). The Standard proxy is phase 1 and the SVR proxy phase 2; at both blocks they returned the identical round, answer and `updatedAt`.
- Last 40 rounds: NVDA (Sep 21 → Sep 25) — all 39 updates moved ≥0.5% from the previous answer; median gap 3,185s. SPY (Aug 25 → Sep 25) — 27 updates moved ≥0.5%, 10 came after exactly 24h with smaller moves, and 2 were the first update after a market closure; median gap 60,978s.
- The first update after each weekend in the SPY history landed at 20:00 ET Sunday (00:00 UTC Monday), not at the documented 18:00 ET start. No documented explanation was found; this is an observation only.

**Inferred** (from that history, not documented):

- The observed cadence is fully explained by the documented 0.5% deviation / 24h heartbeat / closed-market behavior. There is no sign of a malfunction; old timestamps are what these feeds do when prices move less than 0.5%.
- Sampled every 60s inside our REGULAR session (the worker's cadence), the age was ≤900s in **21.8%** of NVDA checks (16.9–28.5% per day, Sep 21–25) and **2.8%** of SPY checks (usually one 15-minute window a day; 10 of 23 days had none).
- A 900s rule on `updatedAt` therefore admits trades only in the 15 minutes after an update, which mostly follow ≥0.5% moves. It does not make the reference more precise than the feed's own 0.5% deviation band, and the mandate's 15 bps premium cap is tighter than that band. The absolute price cap is the bound that does not depend on reference freshness. These are policy observations only; no limit was changed.

**Recommendation: A** — the current Standard-proxy feeds can support the existing 900s policy during identifiable conditions: inside the feed's active hours, within 900s of a round update, in a session our mandate permits, with no oracle pause, multiplier transition, halt or pending corporate action. NVDA meets the freshness part often; SPY rarely. A different reference product is not required for the policy as written.

Constraints that follow directly:

- **NVDA is policy-blocked regardless of freshness** while its cash dividend (process date 2026-10-01) is pending review.
- **No qualifying window exists before the 2026-09-28 00:00 UTC deadline under the default mandate.** The feeds closed at 17:00 ET Friday (Sep 25) and reopen Sunday (18:00 ET documented; 20:00 ET observed = the deadline). The default mandate trades only in the regular session, and the next one opens Monday 09:30 ET, after the deadline.
- For reference, the documented upstream is Chainlink Data Streams, report schema v11 ("Tokenized equity feeds use the Data Streams v11 report schema for sourcing the underlying equity market price"). v11 carries `observationsTimestamp`, `lastSeenTimestampNs` (mid price only) and `marketStatus`, and says to use `marketStatus`, not timestamps, to decide whether a market is open. It documents no multiplier field, so using it would mean applying `uiMultiplier` ourselves exactly once. Access is self-serve via app.chain.link. Pricing and Robinhood Chain verifier support were not found in the pages reviewed. This is not recommended now and was not implemented.

## Evidence provenance, 2026-09-25

Enforced in the shared execution validator (`src/engine/executionValidator.ts`), not only in prompts or scripts:

- Every evidence packet must carry `provenance: LIVE | SYNTHETIC | REPLAY | MIXED`; a packet without it is `UNUSABLE_EVIDENCE`. `MIXED` is always rejected.
- Callers must declare a purpose. `live_execution` requires `provenance: LIVE` **and** attestation by a live adapter (`src/engine/provenance.ts`, a registry of object identities that JSON from a request body or the database can never enter). Any other purpose value fails closed to `live_execution`.
- Only the live quote adapter (`src/engine/quote.ts`) and the worker's live prerequisite adapter and combined packet (`src/orders/worker.ts`) attest evidence, which a source scan in `test/provenance.test.ts` checks.
- The worker derives provenance per component: `LIVE` only in a live run where every component is attested; `SYNTHETIC`/`REPLAY` only when all components agree in a non-live run; anything else is `MIXED`, which is a deterministic `UNKNOWN` with no planner call.
- `OrderStore.reserve()`, the step before any broadcast, always validates with `live_execution`. Synthetic evidence, or JSON claiming `LIVE`, throws `EVIDENCE_NOT_LIVE` and reserves nothing.
- Labeled simulation previews are preserved. On non-live evidence an accepted `PROPOSE_EXECUTION` becomes `SIMULATION_PREVIEW` (`liveExecutable: false`); only attested live evidence can yield `EXECUTION_DISABLED_PREVIEW`. Signing stays disabled either way.
- Each planning decision carries an exact label, for example `REAL SERV CALL ON SYNTHETIC MARKET DATA`. "Real" requires a recorded HTTP response from SERV, not merely the absence of a synthetic flag.
- Public input cannot assign provenance: the mandate schema is strict, and no HTTP route accepts evidence.

Tests (`test/provenance.test.ts`, 17): live execution rejects SYNTHETIC and REPLAY; MIXED is rejected for both purposes; a JSON-borne LIVE label is rejected; only attested live evidence is live-executable; an unknown purpose fails closed; a mandate carrying `provenance` fails; `reserve()` rejects synthetic and forged evidence; three mixed live-path cases hard-stop without a planner call; a real-shaped SERV result on synthetic data is labeled exactly; attested live test doubles yield an execution-disabled preview with nothing reserved; the attestation-caller scan. Removing the MIXED guard or the attestation requirement fails 8 of these.

## SERV behavior on synthetic evidence, 2026-09-25

Inspected against what SERV actually received (persisted planner input of the 20:44Z run):

- The system prompt `fairtick.v2` (hash `1e30ec89…`) never mentions synthetic data or simulation. It permits `PROPOSE_EXECUTION` "only when supplied deterministic evidence says there is a permitted candidate".
- The input permitted `PROPOSE_EXECUTION | WAIT | ESCALATE`, said the candidate was `permittedByCode: true, signingEnabled: false`, and labeled provenance "SYNTHETIC evidence for verification; not a market observation".

Finding: proposing execution was appropriate to that prompt. The prompt never asked it to refuse synthetic evidence, and the candidate was code-validated. Its reason attributed everything to "supplied evidence" and did not claim a live observation; it simply did not mention that the data was synthetic. The labeling gap was ours: the run was stored as `EXECUTION_DISABLED_PREVIEW`.

Now the input states the run is a labeled simulation whose proposals can only yield a simulation preview, and the stored outcome is `SIMULATION_PREVIEW`. In the 21:22Z authenticated run SERV again proposed execution, and its reason said "Evidence indicates the action is only a simulation preview and not signing permission" (`serv-path-1790371357185.json`). The versioned system prompt is unchanged.

## Smallest practical demo amount, 2026-09-25

On the active NVDA/USDG 0.05% route at block 72540390, read-only QuoterV2 quotes of 0.1, 0.5, 1, 5 and 25 USDG all returned 225.185006–225.185031 USDG per NVDA. Size is not a pricing constraint at these amounts.

**Proposed: 1 USDG** (1,000,000 base units) → quoted 4,440,792,994,942,873 NVDA base units (≈0.004441 NVDA). A new confirmed mandate would be needed; no existing mandate is changed.

Constraints:
- The desk's fixed minimum fill is 1 USDG, and the validator requires minimum fill ≤ fill ≤ per-fill cap ≤ budget.
- At a 250 USDG/NVDA price cap the committed minimum output would be 4,000,000,000,000,000 base units, below the quoted output.
- The per-transaction L1 posting portion does not shrink with size (817–1,391 L2 gas measured today), so fees are a larger share of a small fill. The total fee is not measured.
- NVDA's pending corporate action still blocks it at any size.

This quote proves pricing only. It does not show sender-specific simulation, allowance, gas readiness, or whether the stock token accepts the recipient: the earlier `STF` revert happened before the token transfer step.

---

## SERV planning in the order worker, 2026-09-25

Implemented with the existing planner (`requestPlan`, `fairtick.v2.txt`, strict schema); no second planner or decision engine. Per worker cycle (`src/orders/worker.ts`):

1. Load the confirmed mandate and order; reconcile any pending transaction first; stop on cancellation or expiry.
2. Gather evidence: actual-size quote/reference snapshot plus measured prerequisites (route bytecode, evidence-block freshness, wallet balances, allowance, fee bound). Unmeasured values stay `null`.
3. Deterministic hard stops: if the execution validator rejects, the reference is not USABLE, halt or corporate-action status is anything but `false`, or no quote exists, code records the decision (`WAIT`, `UNKNOWN` or `REFUSE`; origin `code`; `plannerCalled: false`). **No inference is spent.**
4. Only when code has found a permitted candidate is SERV called, with permitted actions `PROPOSE_EXECUTION | WAIT | ESCALATE` and evidence IDs for the mandate limits (wallet addresses withheld), remaining budget, recent order history, reference, quote, session, asset status, the deterministic candidate, prerequisites and provenance (synthetic vs live).
5. The worker re-checks the result itself, because planners are injectable: strict schema (extra fields such as budget, price, recipient or deadline are rejected), permitted action, and own-key evidence IDs. Worker-level timeout 45s.
6. `OrderStore.applyPlan` runs in one `BEGIN IMMEDIATE` transaction: lease still held; order not cancelled, not expired, and its content-addressed version unchanged since before inference; evidence still within the quote, block and feed age limits. A `PROPOSE_EXECUTION` is then revalidated by `prepareBuy`/`validateExecution` at the acceptance instant against current state.
7. Persisted: planner metadata (status, model, request/response IDs, latency, usage, prompt version and hash — never credentials), the proposal or the untrusted raw output, the validation result, the full planner input, the applied outcome, and an append-only `PLANNED` event.

Outcomes: `EXECUTION_DISABLED_PREVIEW` (unsigned calldata; `transactionAuthorized`, `signed`, `submitted` and `fundsReserved` all false; order to Needs attention), `WAIT_ACCEPTED`, `ESCALATED`, `REJECTED_BY_REVALIDATION`, `SERV_UNAVAILABLE`, `PLANNER_REJECTED_<reason>`, `DISCARDED_*_DURING_INFERENCE`, `DISCARDED_STALE_EVIDENCE`. **No planning outcome creates a spend reservation or fill intent**, and signing remains hard-disabled.

Labels: a decision is `origin: serv` only when SERV returned content, valid or not. Missing credentials, timeouts and HTTP/transport failures are `origin: code`. The desk shows the latest decision's recorded origin instead of a fixed "deterministic code" sentence.

Failure policy: missing credentials → `SERV_UNAVAILABLE` and Needs attention immediately (retrying cannot fix configuration). Invalid output, unsupported action, invented evidence ID, timeout or transport error → a counted failure; managed orders back off (60s doubling, max 900s) and reach Needs attention after five consecutive failures. Total checks — and therefore inference calls — are bounded by the mandate's `maxAttempts`.

Verified with synthetic planner responses through the real worker, store and temporary SQLite files (`test/planning.test.ts`, 24 tests): valid proposal → preview with no reservation; valid WAIT and ESCALATE; a tamper attempt (extra budget, price, recipient and deadline fields) rejected with the stored mandate byte-identical; an execution proposal rejected by revalidation when the 16:00 ET close passes during inference; malformed output, unknown and unpermitted actions, invented and inherited-name evidence IDs, HTTP failure, thrown planner and timeout — none reserve; cancellation, expiry, an out-of-band change and stale evidence during inference each discard the proposal; two workers on separate connections produce one planning result and no intent; five hard-stop cases never call the planner. A deliberate mutation check confirmed the cancellation test fails when its guard is removed.

Not verified: any authenticated SERV response. With the key absent, `npm run verify-serv-path` runs the real planner through the real worker and store and records `SERV_UNAVAILABLE` (`data/evidence/serv-path-1790367324386.json`). With `SERV_API_KEY` set, the same command makes one bounded authenticated request using **synthetic** evidence, labeled as such to SERV — that verifies the integration, not live market behavior. In live operation today SERV is never reached, because every live cycle hard-stops (stale reference, no configured sender).

Scope note: SERV's decision space here is narrow — propose, wait or escalate on a candidate code has already validated. Whether it adds anything beyond the deterministic gate is unmeasured; this connection does not establish a product benefit.

## Transaction fee estimation: verified semantics and correction, 2026-09-25

Sources, fetched 2026-09-25: Arbitrum, "How to estimate gas" (https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas); `NodeInterface.sol` (OffchainLabs/nitro-contracts, `src/node-interface/NodeInterface.sol`); `ArbGasInfo.sol` (OffchainLabs/nitro-precompile-interfaces).

What the sources establish:

- `eth_estimateGas` "returns a gas limit sufficient to cover the entire transaction fee at the current child chain gas price", and "multiplying the value from `eth_estimateGas` by the child chain gas price gives you the total ETH required." It already includes the L1 posting buffer.
- `NodeInterface.gasEstimateComponents` is "Same as native gas estimation, but with additional info on the l1 costs": `gasEstimate` (total gas), `gasEstimateForL1` (gas for the L1 component — a subset of the total), `baseFee` (L2 base fee), `l1BaseFeeEstimate` (ArbOS's L1 base fee estimate).
- `gasEstimateL1Component` returns `gasEstimateForL1`, `baseFee` and `l1BaseFeeEstimate` without the L2 part, "so that the l1 component can be known even when the tx may fail". Both methods are `payable` (not `view`) and are called with `eth_call`.
- The L1 component in wei is `gasEstimateForL1 × baseFee` (the docs' own example multiplies it by the child-chain price).

Method now implemented (`estimateTransactionFee`, `src/lib/executionEvidence.ts`):

| Field | Source | Unit |
| --- | --- | --- |
| `estimatedGas` | `eth_estimateGas` from the configured sender (exact route, amount and recipient; placeholder minimum output) | L2 gas, **includes L1 posting** |
| `gasPriceWei` | `eth_gasPrice` | wei per L2 gas |
| `pointEstimateWei` | `estimatedGas × gasPriceWei` | wei |
| `gasLimit`, `maxFeePerGasWei` | ceiling of ×1.2 of the two above (policy headroom) | gas; wei per gas |
| `feeUpperBoundWei` | `gasLimit × maxFeePerGasWei` — a bound only if a future signer sets gas ≤ `gasLimit` and maxFeePerGas ≤ `maxFeePerGasWei` (under EIP-1559 the effective price never exceeds maxFeePerGas) | wei |
| `l1Component` | `NodeInterface.gasEstimateL1Component`, reported as a **subset**, never added | gas; wei = gas × L2 `baseFee` |

Double counting is excluded by construction and by test, and unit consistency is tested. An L1 subset larger than the total makes the estimate UNAVAILABLE rather than guessed. No sender, a failed estimate or a failed price read yields UNAVAILABLE with `null` amounts, and a failed L1 read stays `null`, never `0`. This is an estimate for the mandate's gas cap; actual fees come only from the receipt (`gasUsed × effectiveGasPrice` in `receipt.ts`) and are kept separate.

Observed on this chain on 2026-09-25 — **the L1 posting price is dynamic, not zero:**

| Read | Morning (~12:50Z; 4-byte probe data) | 20:23:56Z, block 72510632 (real 420-byte swap calldata; `npm run probe-l1-fee`) |
| --- | --- | --- |
| `NodeInterface.gasEstimateL1Component` | `gasEstimateForL1 = 0`, `baseFee = 35,774,000`, `l1BaseFeeEstimate = 0` | `gasEstimateForL1 = 1,383` L2 gas, `baseFee = 35,938,000`, `l1BaseFeeEstimate = 7,751,620` → L1 part = 1,383 × 35,938,000 = **49,702,254,000 wei** |
| `ArbGasInfo.getL1BaseFeeEstimate()` | 0 | 7,751,620 |
| `ArbGasInfo.getPricesInWei()` per L1 calldata byte / per L2 tx | 0 / 0 | 124,025,920 (= 16 × 7,751,620) / 17,363,628,800 (= 140 bytes × 124,025,920) |
| `eth_gasPrice` | 35,850,000 | 35,724,000 |

The morning zeros were a point-in-time value of ArbOS's L1 price estimate, which moved later the same day. Both evening readings are internally consistent with Arbitrum's model (16 L1 gas per byte, a 140-byte per-transaction overhead). Evidence: `data/evidence/l1-fee-1790367836681.json`. This makes the formula correction material rather than theoretical: on the evening reading the old formula would have added a separate `1,383 × 7,751,620 = 10,720,490,460` wei (L2 gas × L1 price, a unit error) on top of a total that already contains the correct 49,702,254,000 wei L1 part.

Limit: whether this endpoint's `eth_estimateGas` total includes the L1 part exactly as `gasEstimateComponents` would report has not been compared, because that needs a funded sender. The subset guard refuses to estimate if the reported L1 part ever exceeds the total.

Check names now match what they establish:

- `routeBytecodePresent` (was `contractsVerified`): code exists at the token, quote token, pool and router at the evidence block. **Not** contract identity — there is no code-hash or proxy-implementation pinning, and USDG and the stock token are proxies.
- `evidenceBlockFresh` (was `networkHealthy`): the evidence block is at most 30s old by the local clock. **Not** comprehensive network health — sequencer status, cross-RPC agreement, batch posting and finality lag are not measured. It overlaps the mandate's `maxBlockAgeSeconds`.

A signing release would need to strengthen both (identity pinning and a real health signal) before any purchase.

---

## Fresh asset investigation, 2026-09-25

Re-run today, not reused from 2026-09-24. Both commands are reproducible: `npm run verify-dependencies` (NVDA) and `npm run probe-candidate` (SPY). Full JSON: `data/evidence/gate-a-2026-09-25T12-51-*.json` and `data/evidence/candidate-SPY-1790340789662.json`.

| Field | NVDA | SPY |
| --- | --- | --- |
| Observed at | 2026-09-25T12:51:52.930Z | 2026-09-25T12:53:02.292Z |
| Block | 72240707 | 72241413 |
| Token | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| Feed proxy | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | `0x319724394D3A0e3669269846abE664Cd621f9f6A` |
| Feed round | 18446744073709552716 | 18446744073709551761 |
| Feed updatedAt | 1790317336 (2026-09-25T06:22:16Z) | 1790309069 (2026-09-25T04:04:29Z) |
| **Measured age** | **23,376s** | **31,715s** |
| vs 900s cap | **STALE** | **STALE (usable: false)** |
| oraclePaused | false | false |
| multiplier state | CONSISTENT (current == pending, both 1000775159164630595) | not a transition (current == pending, both 1001717991187472003) |
| Pending corporate action | **true** — cash dividend, processDate 2026-10-01, IN_PROGRESS | false |
| Trading halt | false | false |
| Route liquidity | NVDA/USDG 0.05%, liquidity 11,305,078,801,622,797,935 (unchanged pool) | Two pools found: 0.05% fee (liquidity 741,486,257,906,668,750) and 0.3% fee (liquidity 32,195,746,568,606,935) |
| Actual 25 USDG quote | 110,743,333,885,850,531 NVDA-wei, price impact 5.00 bps | 32,409,453,905,257,774 SPY-wei (0.05% pool), price impact ~0 bps at this size |
| **Eligible for promotion** | No (stale + pending corporate action) | **No (stale)** — reference/halt/corporate-action/route checks otherwise pass |

**Conclusion: neither asset passes today.** Both are blocked specifically on feed staleness, which is a live market-data fact (how recently the aggregator posted an update), not a code defect — the 900-second cap was not changed, weakened, or bypassed for either asset. SPY additionally clears every other check (no pause, no pending corporate action, no halt, and it has a real USDG-denominated pool with quoted liquidity at two fee tiers) — if its feed is fresh on a later re-run while NVDA's is not, it would be the more promising candidate for promotion at that time. NVDA carries an additional, independent, non-staleness blocker today: a pending in-progress corporate action, which this system's conservative policy holds for review regardless of feed freshness (see the original finding below — this is unchanged design behavior, not a new restriction). **NVDA remains the sole implemented route; `data/registry.json`, `src/orders/config.ts`, and the hardcoded `"NVDA"` in `src/orders/worker.ts`'s `liveDependencies.quote` were not changed**, since promotion is only warranted when a candidate actually passes and SPY did not today.

## Live-adapter gap closure, 2026-09-25 (earlier; partly superseded)

> **Partly superseded later the same day.** The fee formula in the third bullet double-counted the L1 component and priced L2 gas units at the L1 base fee; its claim that this chain charges no L1 posting fee overgeneralized point-in-time zero readings (a later read was nonzero); and the names `contractsVerified`/`networkHealthy` overclaimed what was measured. All are corrected in "Transaction fee estimation" above. The text below is kept unedited as history.

The worker previously passed `contractsVerified: null`, `networkHealthy: null`, `gasUpperBoundWei: null`, `walletGasBalanceWei: null`, `walletUsdgBalance: null`, `allowance: null` into the execution validator on every cycle — accurate at the time (nothing was measured), but a standing gap. Each is now either genuinely measured or still explicitly `null`, never invented:

- **`contractsVerified`**: `src/lib/executionEvidence.ts`'s `verifyRouteContracts` now checks live bytecode presence (`eth_getCode`) for token, quote token, pool, and router at the snapshot's exact block on every worker cycle. Real boolean, not a placeholder.
- **`networkHealthy`**: defined as "the snapshot's block timestamp is within 30 seconds of wall-clock time," calibrated against a live measurement today of ~9.8 blocks/s and ~1s typical lag on this single-sequencer chain (see `NETWORK_HEALTHY_MAX_LAG_SECONDS` in `executionEvidence.ts` for the exact number and rationale). This is a policy threshold, not a network constant — it exists to catch a stalled sequencer or a lagging RPC endpoint, not to certify performance.
- **`gasUpperBoundWei` (total transaction fee)**: implemented for real, not left as a TODO. On this Arbitrum-Orbit chain, total fee = L2 execution gas × L2 gas price + an L1 data-posting fee. The L1 component uses Arbitrum's `NodeInterface.gasEstimateL1Component` precompile (address `0x...C8`), which — unlike plain `eth_estimateGas` — is designed to answer for an arbitrary transaction shape without the caller holding funds. **Verified live today**: it returns real, non-error values, and independently, `ArbGasInfo.getL1BaseFeeEstimate()` (address `0x...6C`) also reports zero. Both agreeing on zero is treated as a measured finding — this chain's data-availability mode does not appear to charge a per-transaction Ethereum-L1 calldata fee, unlike Arbitrum One/Nova — not an assumption. The L2 execution-gas portion still requires a real `eth_estimateGas` against a funded/configured sender (an unfunded sender fails the same way the documented `STF` revert did, which is a balance failure, not a gas-estimation bug), so `gasUpperBoundWei` stays `null` until `RH_SENDER_ADDRESS` is configured — this is the one piece that is architecturally correct but still practically unavailable today, and it stays that way honestly rather than substituting the Uniswap Quoter's unrelated internal gas figure (explicitly forbidden — the Quoter's gas reflects its own revert-based simulation trick, not the router transaction).
- **`walletGasBalanceWei` / `walletUsdgBalance` / `allowance`**: real `getBalance`/`balanceOf`/`allowance` reads when `RH_SENDER_ADDRESS` matches the mandate's signer; explicit `null` with a `NO_CONFIGURED_SENDER` (or `SENDER_DOES_NOT_MATCH_MANDATE_SIGNER`) reason otherwise. No change in outcome today (still unavailable), but the code path is real and will activate the moment a sender is configured.

None of this changes what the validator concludes today — `RH_SENDER_ADDRESS` is still absent, so wallet/gas evidence is still `null`, and the validator still blocks on `UNUSABLE_EVIDENCE`/stale reference regardless. The change is that the worker's evidence now reflects what was actually measured this cycle, not a permanent placeholder. Source for precompile addresses and semantics: https://docs.arbitrum.io/build-decentralized-apps/precompiles/reference and https://docs.arbitrum.io/build-decentralized-apps/nodeinterface/reference .

## Continuation: precise outstanding findings and storage decision

This continuation supersedes earlier statements that persistence, the worker,
receipt code and UI are absent. They are now implemented locally with signing
disabled; deployment and live-fill verification remain unproven.

Gate A remains INCOMPLETE. The following refines, rather than relaxes, the earlier findings.

| Finding | Recorded evidence and policy |
| --- | --- |
| Stale NVDA reference | Feed `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, block 71639230 at 2026-09-24T20:00:00Z; round 18446744073709552715 updated at unix 1790268116 / 2026-09-24T16:41:56Z. Measured age 11,884 seconds exceeds the configured 900-second maximum. A future check must use its own measured age; the limit is unchanged. |
| Oracle contract state | NVDA token `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC`: oraclePaused=false; uiMultiplier=1000775159164630595; newUIMultiplier=1000775159164630595; effectiveAt=1788998430 / 2026-09-10T00:00:30Z. Equal values and a past timestamp do not establish an active inconsistent multiplier transition. |
| Scheduled corporate action | REST reports a cash dividend IN_PROGRESS with processDate 2026-10-01. This date is not a verified on-chain activation timestamp, and IN_PROGRESS does not mean oraclePaused=true. The initial conservative policy still blocks execution pending review when a corporate action is reported; it does not mislabel that policy hold as an active oracle pause. An actual oracle pause, missing state, or differing multiplier with an unresolved transition independently blocks execution. No corporate action is ignored to force readiness. |
| Sender | Public RH_SENDER_ADDRESS unlocks wallet balance, allowance and sender-specific simulation. A private key would be needed only for future signing, which remains disabled. No key is needed in chat or for these reads. |
| SERV | Put SERV_API_KEY in the git-ignored .env.local file or deployment secret store, then run npm run verify-dependencies. Keep the key out of screenshots/logs/git. Authenticated verification stays incomplete until a genuine request succeeds with validated output. No deterministic decision is labeled SERV. |

Durable setup selected: existing better-sqlite3, WAL mode, synchronous=FULL,
foreign keys and BEGIN IMMEDIATE transactions. Web and worker are separate Node
processes on one host sharing an absolute DATABASE_PATH on a persistent local
volume. SQLite WAL must not be placed on a network filesystem or separate
ephemeral hosts. Multi-host deployment requires a shared transactional database
such as Postgres before enabling that topology. No deployment has been performed.
Source: https://www.sqlite.org/wal.html

### Alternate candidate investigation (not enabled)

`npm run probe-candidate` investigated SPY using official Robinhood assets and
the Chainlink directory without changing `data/registry.json`.
Evidence: `data/evidence/candidate-SPY-1790309322586.json`.

- Observed 2026-09-25T04:08:35Z; block 71930157 / unix 1790309319.
- SPY token `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C`, feed
  `0x319724394D3A0e3669269846abE664Cd621f9f6A`.
- Round 18446744073709551761, answer 76843289680; updatedAt 1790309069;
  measured age 250s within unchanged 900s limit. oraclePaused=false,
  uiMultiplier=newUIMultiplier=1001717991187472003, effectiveAt=1789690233.
- V3 USDG pool `0xa7Bb1AC63BBaB0C44316E6c8C455213441689167`, fee 500,
  nonzero active liquidity 724305132440869063. Actual input 25000000 units,
  quoted output 32519868942995400 units. A second fee tier was also quoted.
- Candidate only: no asset switch, funded simulation, complete corporate-action
  review, signing permission or fresh-at-execution claim. NVDA remains the sole
  implementation route. This observation does not make Gate A complete.

**2026-09-25 update:** re-probed with halt/corporate-action checks added (previously
missing from this script). SPY's reference had gone stale (31,715s) by the time of
the fresh re-check a day later — the 250s-fresh observation above was a one-time
snapshot, not a standing property of SPY. See "Fresh asset investigation" above for
the complete, current comparison.

### Durable-engine evidence

Latest browser checkpoint: `data/evidence/order-smoke-1790329478614.json` at
2026-09-25T09:44:38Z. Headless Chrome confirmed an order through the actual desk,
closed before the two independent worker processes ran, reopened to inspect
persisted status/evidence/accounting, and cancelled on a 390px mobile viewport.
No horizontal overflow was detected. Desktop/mobile screenshots are named
`desk-synthetic-order.png` and `desk-mobile-synthetic-order.png`. Mandates/sender
are synthetic, quotes are live, receipts are empty. This is workflow evidence,
not a live purchase. The earlier Edge attempt did not finish and is not claimed
as a passing browser check.

The browser test exposed an origin-check bug caused by Next's internal localhost
URL normalization; it is fixed and covered by same-host/cross-origin/proxy-origin
regression tests. Production build and TypeScript checking pass.

Migration: `migrations/001_orders.sql`. Store and worker: `src/orders/`.
Verifier: `src/engine/receipt.ts`. Authenticated desk/API: `src/app/`.
`OPERATIONS.md` describes the single-host deployment contract and recovery policy.

The HTTP smoke artifact `data/evidence/order-smoke-1790309647200.json` records
successful authenticated confirmation/idempotency, two independent worker
processes sharing SQLite, one check each, restart without another Buy-now check,
and durable cancellation. Mandates/public address are **synthetic**; snapshots
are **live RPC**. No receipts, signatures or purchases were produced.

That live NVDA snapshot at block 71933323 (timestamp 1790309642) had the same feed
round/update time as above, now 41,526s old against the 900s maximum. Pause=false,
multiplier state CONSISTENT, corporate action pending=true, halt state unavailable.
Missing halt status blocks rather than defaults to false.

Safety tests use real temporary SQLite files with explicitly synthetic chain logs:
four partial fills conserve the budget; duplicate jobs and competing wallet fills
cannot reserve twice; old leases lose mutation rights; restarts reconcile before
quoting; cancellation/expiry retain pending funds; missing/reorged/unfinalized
transactions do not release them. Receipts require matching wallet transfers and
pool amounts. At the time of this historical test description, total L2 fee was
unverified in the live adapter, so settlement could be verified separately while
mandate compliance remained false. The September 28 public-testnet reconciliation
at the top of this file supersedes that limitation for supported Nitro receipts.

The worker calls the shared validator in both modes; unmeasured contract/network,
wallet and total-gas prerequisites remain explicitly unavailable. It records a
deterministic blocked decision and does not reserve/sign/broadcast in this build.
Pending-transaction imports are internal recovery methods, not HTTP endpoints.

**2026-09-25 update:** contract/network prerequisites (`contractsVerified`,
`networkHealthy`) are now genuinely measured every cycle rather than hardcoded
null; wallet/gas prerequisites are genuinely measured when `RH_SENDER_ADDRESS`
is configured and remain explicitly null otherwise. See "Live-adapter gap
closure" above.

## Current re-verification: 2026-09-24 20:00 UTC

**Gate A remains incomplete.** This section supersedes conflicting historical
claims below. An API trading halt is not the oracle pause signal. A configured
sender has not been simulated. Successful reads do not prove execution readiness.

Reproduce with `npm run verify-dependencies`. Timestamped JSON in `data/evidence/`
records source URLs, fetch times, selected source records, response hashes,
addresses, contract interfaces, blocks, quote, configuration presence and blockers.
No private keys or configured RPC URLs are exported. `npm run smoke-quote` reads
a fresh snapshot. All commands are read-only except local evidence files and one
diagnostic inference if SERV credentials are present.

Workspace inspection: clean git at starting commit d2ca1ea, existing code preserved;
no applicable AGENTS.md found. Node 24.13.1, npm 11.8.0, npm lockfile. Only
`.env.example` existed. SERV key, sender/private key, RPC override, DB configuration
and operator secret absent. No durable store, deployed worker or Next.js UI exists.
Installed SQLite is not an implemented persistence layer.

### Measured observations

- Public RPC: chain **4663**, contract-check block **71639215**, hash
  `0xba96fd866f9cf0a57ad8693772e9eaf626996b5d87f98c16fd3e7e850db9a5f9`.
  Bytecode present at USDG, token, feed, pool, factory, router and quoter. Router
  and quoter factories match; factory lookup confirms the registered pool;
  token0=USDG, token1=NVDA, decimals 6/18, active liquidity nonzero.
- Quoter code is **8,273 bytes**; historical 16,548 counted hex characters.
- Official Robinhood assets and Chainlink directory returned HTTP 200 and match
  the existing NVDA/feed addresses. Uniswap deployment page returned HTTP 200 via
  direct Node fetch and contains the configured router/quoter addresses.
- Quote/reference block **71639230**, hash
  `0x7cc00dcb6446dc8f93a46bbb6f1fedb43dec6772851bdd3ef08cd83635bbbf21`,
  timestamp **1790280000**. Every contract read within this packet is pinned to
  that block, distinct from the preceding interface-check block.
- Input **25,000,000** USDG units; output **111,209,709,732,054,018** NVDA units.
  Effective price **224.8005148 USDG/token**, impact versus spot **5.004 bps**,
  including the 0.05% pool fee. Quoter gas **109,401 units** is not router/L2 total
  gas or a USD gas estimate. USDG/USD parity remains an assumption.
- Reference answer **22440881781**, decimals **8**, round
  **18446744073709552715**, updatedAt **1790268116**, age **11,884 seconds**.
  **STALE** under the 900-second policy. Premium withheld rather than actionable.
- A short follow-up probe at 20:02 UTC read the directory's underlying aggregator
  directly: round 1099, same answer and updatedAt 1790268116. The stale timestamp
  was not isolated to the proxy. No feed was silently substituted. Full follow-up:
  `data/evidence/gate-a-2026-09-24T20-02-25-281Z.json`.
- `oraclePaused=false`; `uiMultiplier` and `newUIMultiplier` both
  **1000775159164630595**; `effectiveAt=1788998430` (past). No differing staged
  multiplier observed. Feed already includes multiplier, never applied twice.
  Method semantics: https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
- Fresh API halt false; corporate actions report NVDA cash dividend IN_PROGRESS,
  process date 2026-10-01. The conservative execution gate requires review for any
  pending action. This is distinct from oracle pause. REST cache windows are 15s
  for prices and one hour for corporate actions, per
  https://docs.robinhood.com/chain/stock-token-apis/
- Actual asset tradingCapabilities is nested by market/extended/overnight and
  whole/fractional, unlike the flat documentation example. No execution permission
  is inferred from this unvalidated shape.

### Simulation and SERV

Configured-sender simulation: **BLOCKED, NO_CONFIGURED_SENDER**. Set public
`RH_SENDER_ADDRESS` locally for read-only balance/allowance and router simulation;
no private key required. Diagnostic simulation is not mandate-compliance proof.

SERV: **BLOCKED, SERV_API_KEY_MISSING**. No authenticated call, latency or usage
is claimed. Official SDK/tools docs confirm required instructions and guard/shadow
configuration. Direct model-catalog fetch returned HTTP 200 and mentions
gpt-5.4-mini; actual account access and feature behavior remain unverified.

- https://docs.openserv.ai/serv-reasoning/sdk-integration
- https://docs.openserv.ai/serv-reasoning/tools
- https://docs.openserv.ai/serv-reasoning/models.md

Implemented diagnostic uses full `fairtick.v2.txt`, strict action/reason/evidenceIds
schema, and records prompt hash, model, request ID, HTTP status, output validation,
latency and usage when available. Invalid output/transport failures authorize
nothing. No automatic retry or fallback. Worker recovery policy is not implemented.

### Foundation and remaining work

`WORKING-SPEC.md` reconciles conflicts; original PRD is preserved in git. Quote
adapter now reads oracle state and avoids cached registry metadata. Verified 2026
NYSE holidays/early closes replace assumed weekday availability; other years are
UNKNOWN. Source: https://www.nyse.com/trade/hours-calendars

Strict execution schemas bind route, signer, recipient and limits. Integer minimum
output uses conservative ceiling rounding for absolute, premium and slippage
bounds. Reference-relative rules require parity consent. `prepareBuy.ts` encodes
minimum output and SwapRouter02's deadline multicall. Neither signs nor broadcasts.
Live evidence is not yet promoted automatically to verified network/gas inputs.

79 synthetic tests and TypeScript checking pass. Covered: price rounding and
calldata, stale/paused references, unavailable metadata, mandate changes,
budget/pending state, cancellation/expiry inputs and model-output rejection.
Not yet proven: durable budget conservation, worker restarts, duplicate jobs,
actual cancellation races, wallet serialization or receipt reconstruction.

**2026-09-25 update:** 109 synthetic tests now pass (see status table above);
durable budget conservation, worker restarts, duplicate jobs, cancellation races
and receipt reconstruction are now covered by `test/orders.test.ts` (synthetic
fixtures, real temporary SQLite files) — listed there as "Not yet proven" is
stale as of this update; see that file directly for current coverage.

Next: usable reference without relaxed limits, configured sender and SERV key,
total L2 gas/network checks and buy-now receipt reconstruction; then durable orders
and managed worker. Current handoff does not authorize spending or deployment.

---

## Historical record from the prior implementation

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
- Block header's `l1BlockNumber` field and a `miner` address that decodes to the ASCII string `"sequencer"` (`0xa4b0...73657175656e636572`) confirm this is an Arbitrum-Orbit-style L2 with a single sequencer — consistent with Uniswap's own deployments page describing Robinhood Chain as "this Arbitrum Orbit L2 chain (chainId 4663)". **Confirmed further on 2026-09-25**: this chain responds to Arbitrum's `ArbGasInfo`/`NodeInterface` precompiles (see "Live-adapter gap closure" above), which is strong additional evidence this is a genuine Arbitrum Nitro/Orbit stack, not merely a chain that happens to share a chain ID pattern.

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

- **QuoterV2:** `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` — bytecode confirmed present (**8,273 bytes** — an earlier note in this file said "16,548 bytes," which counted hex *characters* of the `0x`-prefixed bytecode string rather than bytes; `(hexLength - 2) / 2` gives the correct byte count. Both readings are of the same real bytecode; only the earlier arithmetic was wrong, not the underlying observation), and `quoteExactInputSingle` calls against it succeeded (see §C).

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

  The 0.05%-fee **NVDA/USDG pool at `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3`** holds roughly two orders of magnitude more of the quote-token balance than the next-largest USDG-denominated candidate, and is directly USDG-denominated (no WETH hop needed, matching first-release scope). This is the selected route. **V3 only** — no V4 pool was found or needed. (On the "depth" wording here, see "Corrections to earlier wording" at the top of this file.)

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

Price impact from 1 USDG to 1000 USDG is ~0.0006% — consistent with the pool depth ranking found in §A. This is the **actual-size quote**, not the pool's spot price substituted for it, satisfying the PRD's explicit "do not substitute pool spot price for the price of the actual order."

**Gas** is reported separately above (router/quoter gas units on an L2; no USDG-to-USD gas conversion is assumed or asserted anywhere in this record — the chain's gas token is ETH per PRD §7). **Note:** this is the Quoter's own internal gas estimate from its revert-based simulation trick, not the real router transaction's cost — see "Live-adapter gap closure" above for the actual total-fee estimation approach, which deliberately does not use this number.

**Transaction simulation with a real configured sender:** no operator wallet is configured (no `RH_PRIVATE_KEY`, see §0), so there is no funded sender to simulate a successful execution with. Per the handoff's explicit instruction ("If balance or allowance prevents simulation, report that exact limitation"), an `eth_call` simulation of `SwapRouter02.exactInputSingle` was run from an arbitrary unfunded address (`0x00…00f1`, a synthetic test address with no known private key, holding zero balance and zero allowance) for a 25 USDG → NVDA swap:

```
Result: reverted with reason "STF"   (Uniswap V3 periphery's SafeTransferFrom-failed error)
```

This is the exact, reproducible on-chain evidence of the blocking limitation: the call is correctly ABI-encoded and reaches the token-transfer step of a real router contract, and fails there specifically because the sender has no USDG balance/allowance — not because of a bad address, wrong selector, or unreachable contract. **This is not a state-override simulation** (no balance/allowance was faked); it is an honest failure demonstrating exactly what a funded wallet would need to supply. A state-override variant (faking `balanceOf`/`allowance` storage) was deliberately not attempted, because USDG is a proxy contract (its bytecode is a minimal EIP-1967-style delegate) and guessing its implementation's storage layout well enough to fake balances safely was judged more likely to produce a misleading "it worked" result than to add real evidence — exactly the failure mode the handoff warns against ("A state-override simulation must be labeled and is not proof of funded readiness").

---

## D. SERV

**Blocked.** `SERV_API_KEY` is not present anywhere in this environment (see §0). No request was made, and none was fabricated. Per official docs review (`https://docs.openserv.ai/serv-reasoning/*`), the integration shape needed once a key exists is: `baseURL: https://inference-api.openserv.ai/v1`, mandatory system prompt, `serv_shadow_agent` + `serv_prompt_guard` tools, `response_format.json_schema`. `src/engine/servPlanner.ts` is written to this shape (implemented, not a stub) so that supplying a key is the only step left to make a genuine authenticated call — but no such call has happened yet (confirmed again on 2026-09-25, see the status table at the top of this file), and nothing in this repo should be read as claiming otherwise.

**Unblock:** set `SERV_API_KEY` (and optionally `SERV_MODEL`, default `gpt-5.4-mini`) in `.env.local`, then re-run `npm run verify-dependencies` to make one real authenticated request and append the result to this file.

---

## 1. Assumptions on record

- **USDG ≈ $1.00** is assumed for any USD-denominated display derived from a USDG amount, because no USDG/USD Chainlink feed was found in the Robinhood feed directory. Native USDG-unit bounds are preferred over converted-USD bounds wherever the mandate allows it, per the merged plan's guidance ("Prefer native USDG-denominated user bounds when USD accuracy is unproven"). This assumption is not yet needed anywhere in the code, since USDG is the input unit throughout v1.
- Gas is paid in ETH; no ETH/USD conversion is asserted anywhere in this record.
- `uiMultiplier` is applied exactly once, for optional share-equivalent display only — never to `feedPriceUsd` (already multiplier-adjusted) or to `dexPriceUsd` (raw-token price, matches raw-token feed price).
- The L1 posting price is dynamic. It read zero on the morning of 2026-09-25 and nonzero that evening (see "Transaction fee estimation"). The fee adapter does not assume either value: it treats `eth_estimateGas` as including the L1 part and reports that part separately.

## 2. Blocked / unresolved (as of 2026-09-25)

1. **SERV_API_KEY missing** — blocks Gate A.D and the SERV decider's live path. Everything else (deterministic engine, threshold bot, quote engine, registry) does not depend on it and was not blocked.
2. **RH_SENDER_ADDRESS / funded operator wallet missing** — blocks configured-sender simulation, wallet balance/allowance evidence, and real L2 gas-unit estimation. The unfunded-sender `STF` revert above is the strongest evidence obtainable without it. (A private key is not required for any of this; it is only relevant to a future, separately authorized signing release, which is hard-disabled in this build regardless.)
3. **OPERATOR_SECRET**: now configured locally by `npm run setup-local` (generated, not printed); required and present for the desk API.
4. **Durable database choice**: `better-sqlite3` WAL, implemented and in active use by `src/orders/store.ts` — no longer a future decision, see `OPERATIONS.md`.
5. On-chain aggregator circuit-breaker bounds (`minAnswer`/`maxAnswer`) for the NVDA feed were not inspected; `isTradingHalt` from the official Robinhood price API is the pause signal implemented in v1.
6. **Neither NVDA nor SPY currently passes reference freshness** (see "Fresh asset investigation" above) — this is a live market-data condition, re-check periodically; do not loosen the 900s cap to work around it.

## 3. Reproducing this record

All commands above are copy-pasteable. The equivalent, permanent, re-runnable version of this discovery lives in [`scripts/resolve-registry.ts`](scripts/resolve-registry.ts) (registry resolution), [`scripts/verify-dependencies.ts`](scripts/verify-dependencies.ts) (full Gate A re-check), and [`scripts/probe-candidate.ts`](scripts/probe-candidate.ts) (alternate-asset investigation), which regenerate `data/registry.json` and `data/evidence/*.json` from the same live sources.
