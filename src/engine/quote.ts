import { parseAbi, formatUnits } from "viem";
import { assertChainId, getPublicClient, USDG_DECIMALS } from "../lib/chain.js";
import { getVerifiedSymbol, routeContracts } from "../lib/registry.js";
import { activeNetwork } from "../lib/network.js";
import { computePremiumBps } from "./premium.js";
import { sessionAt } from "./session.js";
import { attestLive } from "./provenance.js";
import type { MarketSnapshot, ReferenceStatus } from "./types.js";

const FEED_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

const TOKEN_ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function oraclePaused() view returns (bool)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
]);

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

// Default quote size when the caller doesn't specify one (quote-only calls
// before a mandate exists). Matches the PRD demo mandate default.
export const DEFAULT_QUOTE_INPUT_USDG_BASE_UNITS = 25_000_000n; // 25 USDG at 6 decimals

export interface GetMarketSnapshotParams {
  symbol: string;
  inputUsdgBaseUnits?: bigint;
  now?: Date;
  maxFeedAgeSeconds?: number;
}

/**
 * QuoteEngine: the sole producer of MarketSnapshot. Failure policy per PRD
 * §9 — any missing feed, non-positive feed price, or failed pool/quote read
 * produces a snapshot with referenceStatus != "USABLE" and explanatory
 * notes, rather than throwing or substituting an off-chain price. Deciders
 * are responsible for turning an unusable snapshot into UNKNOWN.
 */
export async function getMarketSnapshot(params: GetMarketSnapshotParams): Promise<MarketSnapshot> {
  const now = params.now ?? new Date();
  const inputUsdgBaseUnits = params.inputUsdgBaseUnits ?? DEFAULT_QUOTE_INPUT_USDG_BASE_UNITS;
  if (inputUsdgBaseUnits <= 0n) throw new Error("Quote input must be positive");
  const notes: string[] = [];

  await assertChainId();
  const net = activeNetwork();
  const entry = getVerifiedSymbol(params.symbol);
  const contracts = routeContracts();
  const client = getPublicClient();

  const block = await client.getBlock();

  let referenceStatus: ReferenceStatus = "USABLE";
  let feedPriceUsd: number | null = null;
  let feedRoundId: string | null = null;
  let feedUpdatedAt: number | null = null;
  let feedAgeSeconds: number | null = null;
  let feedAnswerRaw: string | null = null;
  let observedFeedDecimals = entry.feed.decimals;
  let oraclePaused: boolean | null = null;
  let uiMultiplier = "unknown";
  let pendingMultiplierRaw: string | null = null;
  let multiplierEffectiveAt: number | null = null;
  let multiplierState: MarketSnapshot["multiplierState"] = "UNAVAILABLE";
  try {
    const [paused, multiplier, pending, effectiveAt] = await Promise.all([
      client.readContract({ address: entry.token.address, abi: TOKEN_ABI, functionName: "oraclePaused", blockNumber: block.number }),
      client.readContract({ address: entry.token.address, abi: TOKEN_ABI, functionName: "uiMultiplier", blockNumber: block.number }),
      client.readContract({ address: entry.token.address, abi: TOKEN_ABI, functionName: "newUIMultiplier", blockNumber: block.number }),
      client.readContract({ address: entry.token.address, abi: TOKEN_ABI, functionName: "effectiveAt", blockNumber: block.number }),
    ]);
    oraclePaused = paused;
    uiMultiplier = multiplier.toString();
    pendingMultiplierRaw = pending.toString();
    multiplierEffectiveAt = Number(effectiveAt);
    multiplierState = "CONSISTENT";
    if (paused) referenceStatus = "PAUSED";
    if (multiplier <= 0n) referenceStatus = "UNAVAILABLE";
    if (pending > 0n && pending !== multiplier) {
      multiplierState = effectiveAt > block.timestamp ? "SCHEDULED" : "INCONSISTENT";
      notes.push(`${multiplierState}_MULTIPLIER_TRANSITION_REQUIRES_REVIEW`);
      if (!paused) referenceStatus = "UNAVAILABLE";
    }
  } catch {
    referenceStatus = "UNAVAILABLE";
    notes.push("ORACLE_STATE_UNAVAILABLE");
  }

  try {
    const [feedDecimals, roundData] = await Promise.all([
      client.readContract({ address: entry.feed.proxyAddress, abi: FEED_ABI, functionName: "decimals", blockNumber: block.number }),
      client.readContract({ address: entry.feed.proxyAddress, abi: FEED_ABI, functionName: "latestRoundData", blockNumber: block.number }),
    ]);
    const [roundId, answer, , updatedAt, answeredInRound] = roundData;

    observedFeedDecimals = feedDecimals;
    feedAnswerRaw = answer.toString();
    if (answer <= 0n || roundId <= 0n || updatedAt <= 0n || updatedAt > block.timestamp || updatedAt > BigInt(Math.floor(now.getTime() / 1000))) {
      referenceStatus = "UNAVAILABLE";
      notes.push("FEED_NON_POSITIVE_ANSWER");
    } else if (answeredInRound !== roundId) {
      // Carried-over round: the aggregator hasn't produced a fresh answer for
      // this round yet. Treat conservatively as stale rather than usable.
      referenceStatus = "UNAVAILABLE";
      notes.push("FEED_ROUND_CARRIED_OVER");
    }

    feedPriceUsd = Number(answer) / 10 ** feedDecimals;
    feedRoundId = roundId.toString();
    feedUpdatedAt = Number(updatedAt);
    feedAgeSeconds = Math.max(Number(block.timestamp), Math.floor(now.getTime() / 1000)) - feedUpdatedAt;
    if (referenceStatus === "USABLE" && feedAgeSeconds > (params.maxFeedAgeSeconds ?? 900)) referenceStatus = "STALE";

    if (referenceStatus === "USABLE" && feedAgeSeconds > entry.feed.heartbeatSeconds * 2) {
      // Independent sanity check beyond mandate-level staleness: an answer
      // far past its own heartbeat is worth flagging even before a mandate
      // is known.
      notes.push(`FEED_AGE_EXCEEDS_2X_HEARTBEAT(${feedAgeSeconds}s > ${entry.feed.heartbeatSeconds * 2}s)`);
    }
  } catch (err) {
    referenceStatus = "UNAVAILABLE";
    notes.push("FEED_READ_FAILED");
  }

  let dexSpotPriceUsdg: number | null = null;
  try {
    const [slot0, token0] = await Promise.all([
      client.readContract({ address: entry.pool.address, abi: POOL_ABI, functionName: "slot0", blockNumber: block.number }),
      client.readContract({ address: entry.pool.address, abi: POOL_ABI, functionName: "token0", blockNumber: block.number }),
    ]);
    const sqrtPriceX96 = slot0[0];
    const isTokenToken0 = token0.toLowerCase() === entry.token.address.toLowerCase();
    // rawPriceRatio = token1_raw per token0_raw (Uniswap V3 sqrtPriceX96 definition).
    const rawPriceRatio = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
    dexSpotPriceUsdg = isTokenToken0
      ? // token is token0, USDG is token1: rawPriceRatio adjusted for decimals IS usdg-per-token.
        rawPriceRatio * 10 ** (entry.token.decimals - USDG_DECIMALS)
      : // token is token1, USDG is token0: rawPriceRatio adjusted gives token-per-usdg; invert.
        1 / (rawPriceRatio * 10 ** (USDG_DECIMALS - entry.token.decimals));
  } catch (err) {
    notes.push("POOL_SPOT_READ_FAILED");
  }

  let executableQuote: MarketSnapshot["executableQuote"] = null;
  try {
    const sim = await client.simulateContract({
      address: contracts.quoter,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      blockNumber: block.number,
      args: [
        {
          tokenIn: contracts.usdg,
          tokenOut: entry.token.address,
          amountIn: inputUsdgBaseUnits,
          fee: entry.pool.feeTier,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const [amountOut, , , gasEstimate] = sim.result;
    if (amountOut === 0n) {
      notes.push("QUOTE_ZERO_OUTPUT");
    } else {
      const inUsdg = Number(formatUnits(inputUsdgBaseUnits, USDG_DECIMALS));
      const outToken = Number(formatUnits(amountOut, entry.token.decimals));
      const effectivePrice = inUsdg / outToken;
      const priceImpactBps =
        dexSpotPriceUsdg && dexSpotPriceUsdg > 0
          ? ((effectivePrice - dexSpotPriceUsdg) / dexSpotPriceUsdg) * 10_000
          : null;
      executableQuote = {
        inputUsdgBaseUnits: inputUsdgBaseUnits.toString(),
        outputTokenBaseUnits: amountOut.toString(),
        effectivePriceUsdgPerToken: effectivePrice,
        priceImpactBps,
        gasEstimateUnits: gasEstimate.toString(),
      };
    }
  } catch (err) {
    notes.push("EXECUTABLE_QUOTE_FAILED");
  }

  let premiumBps: number | null = null;
  if (feedPriceUsd !== null && executableQuote !== null && referenceStatus === "USABLE") {
    premiumBps = computePremiumBps(executableQuote.effectivePriceUsdgPerToken, feedPriceUsd);
  } else if (referenceStatus === "USABLE" && (feedPriceUsd === null || executableQuote === null)) {
    referenceStatus = "UNAVAILABLE";
    notes.push("PREMIUM_INPUTS_INCOMPLETE");
  }

  // Never copy cached registry metadata into a fresh evidence packet.
  let tradingHalt: boolean | null = null;
  let pendingCorporateAction: boolean | null = null;
  if (net.marketData === "TESTNET_MOCK") {
    // A mock demo asset has no exchange, halts or corporate actions, and no official
    // source to ask. Stated as not applicable, never as an official observation.
    tradingHalt = false;
    pendingCorporateAction = false;
    notes.push("TESTNET_MOCK_MARKET: mock tokens, operator-set mock price, controlled liquidity; not market data",
      "TRADING_HALT_NOT_APPLICABLE_MOCK_ASSET", "CORPORATE_ACTIONS_NOT_APPLICABLE_MOCK_ASSET",
      "SESSION_IS_US_CASH_MARKET_CALENDAR_NOT_A_MOCK_MARKET_HOURS_SOURCE");
  }
  const metadata = net.marketData === "TESTNET_MOCK" ? [] as PromiseSettledResult<any>[] : await Promise.allSettled([
    fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(params.symbol)}`, { signal: AbortSignal.timeout(10000) }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
    fetch("https://api.robinhood.com/rhj/corporate-actions", { signal: AbortSignal.timeout(10000) }).then(async r => { if (!r.ok) throw new Error(); return r.json(); }),
  ]);
  const prices = metadata[0];
  if (prices?.status === "fulfilled" && Array.isArray(prices.value?.quotes)) {
    const row = prices.value.quotes.find((q: { tokenSymbol?: string }) => q.tokenSymbol === params.symbol);
    const age = now.getTime() - Date.parse(row?.generatedAt);
    if (typeof row?.isTradingHalt === "boolean" && age >= 0 && age <= 60000) tradingHalt = row.isTradingHalt;
  }
  const actions = metadata[1];
  if (actions?.status === "fulfilled" && Array.isArray(actions.value?.corpActions)) {
    pendingCorporateAction = actions.value.corpActions.some((a: { tokenSymbol?: string; status?: string }) => a.tokenSymbol === params.symbol && a.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS");
  }
  if (tradingHalt === null) notes.push("TRADING_HALT_UNAVAILABLE");
  if (pendingCorporateAction === null) notes.push("CORPORATE_ACTIONS_UNAVAILABLE");
  notes.push(net.marketData === "TESTNET_MOCK" ? "MOCK_USDG_NOT_USDG" : "USDG_USD_PARITY_ASSUMED", "PRICE_IMPACT_INCLUDES_POOL_FEE", "QUOTER_GAS_IS_NOT_TRANSACTION_GAS");

  return attestLive({
    provenance: "LIVE",
    marketData: net.marketData,
    network: net.label,
    capturedAt: now.toISOString(),
    chainId: net.chainId,
    blockNumber: block.number.toString(),
    blockHash: block.hash as `0x${string}`,
    symbol: params.symbol,
    token: entry.token.address,
    feedProxy: entry.feed.proxyAddress,
    pool: entry.pool.address,
    poolFeeTier: entry.pool.feeTier,
    quoteToken: "USDG",
    referenceStatus,
    feedPriceUsd,
    feedDecimals: observedFeedDecimals,
    feedAnswerRaw,
    blockTimestamp: Number(block.timestamp),
    oraclePaused,
    pendingMultiplierRaw,
    multiplierEffectiveAt,
    multiplierState,
    feedRoundId,
    feedUpdatedAt,
    feedAgeSeconds,
    uiMultiplier,
    dexSpotPriceUsdg,
    executableQuote,
    premiumBps,
    poolTvlUsdgSide: null,
    tradingHalt,
    pendingCorporateAction,
    session: sessionAt(now),
    notes,
  });
}
