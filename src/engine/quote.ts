import { parseAbi, formatUnits } from "viem";
import { assertChainId, getPublicClient, USDG_DECIMALS } from "../lib/chain.js";
import { getVerifiedSymbol } from "../lib/registry.js";
import { computePremiumBps } from "./premium.js";
import { sessionAt } from "./session.js";
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

const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

const QUOTER_ADDRESS = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as const;

// Default quote size when the caller doesn't specify one (quote-only calls
// before a mandate exists). Matches the PRD demo mandate default.
export const DEFAULT_QUOTE_INPUT_USDG_BASE_UNITS = 25_000_000n; // 25 USDG at 6 decimals

export interface GetMarketSnapshotParams {
  symbol: string;
  inputUsdgBaseUnits?: bigint;
  now?: Date;
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
  const notes: string[] = [];

  await assertChainId();
  const entry = getVerifiedSymbol(params.symbol);
  const client = getPublicClient();

  const block = await client.getBlock();

  let referenceStatus: ReferenceStatus = "USABLE";
  let feedPriceUsd: number | null = null;
  let feedRoundId: string | null = null;
  let feedUpdatedAt: number | null = null;
  let feedAgeSeconds: number | null = null;

  try {
    const [feedDecimals, roundData] = await Promise.all([
      client.readContract({ address: entry.feed.proxyAddress, abi: FEED_ABI, functionName: "decimals" }),
      client.readContract({ address: entry.feed.proxyAddress, abi: FEED_ABI, functionName: "latestRoundData" }),
    ]);
    const [roundId, answer, , updatedAt, answeredInRound] = roundData;

    if (answer <= 0n) {
      referenceStatus = "UNAVAILABLE";
      notes.push("FEED_NON_POSITIVE_ANSWER");
    } else if (answeredInRound !== roundId) {
      // Carried-over round: the aggregator hasn't produced a fresh answer for
      // this round yet. Treat conservatively as stale rather than usable.
      referenceStatus = "STALE";
      notes.push("FEED_ROUND_CARRIED_OVER");
    }

    feedPriceUsd = Number(answer) / 10 ** feedDecimals;
    feedRoundId = roundId.toString();
    feedUpdatedAt = Number(updatedAt);
    feedAgeSeconds = Number(block.timestamp) - feedUpdatedAt;

    if (referenceStatus === "USABLE" && feedAgeSeconds > entry.feed.heartbeatSeconds * 2) {
      // Independent sanity check beyond mandate-level staleness: an answer
      // far past its own heartbeat is worth flagging even before a mandate
      // is known.
      notes.push(`FEED_AGE_EXCEEDS_2X_HEARTBEAT(${feedAgeSeconds}s > ${entry.feed.heartbeatSeconds * 2}s)`);
    }
  } catch (err) {
    referenceStatus = "UNAVAILABLE";
    notes.push(`FEED_READ_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  let dexSpotPriceUsdg: number | null = null;
  try {
    const [slot0, token0] = await Promise.all([
      client.readContract({ address: entry.pool.address, abi: POOL_ABI, functionName: "slot0" }),
      client.readContract({ address: entry.pool.address, abi: POOL_ABI, functionName: "token0" }),
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
    notes.push(`POOL_SPOT_READ_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  let executableQuote: MarketSnapshot["executableQuote"] = null;
  try {
    const sim = await client.simulateContract({
      address: QUOTER_ADDRESS,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: entry.pool.token0.symbol === "USDG" ? entry.pool.token0.address : entry.pool.token1.address,
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
    notes.push(`EXECUTABLE_QUOTE_FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  let premiumBps: number | null = null;
  if (feedPriceUsd !== null && executableQuote !== null && referenceStatus === "USABLE") {
    premiumBps = computePremiumBps(executableQuote.effectivePriceUsdgPerToken, feedPriceUsd);
  } else if (referenceStatus === "USABLE" && (feedPriceUsd === null || executableQuote === null)) {
    referenceStatus = "UNAVAILABLE";
    notes.push("PREMIUM_INPUTS_INCOMPLETE");
  }

  return {
    capturedAt: now.toISOString(),
    chainId: 4663,
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
    feedDecimals: entry.feed.decimals,
    feedRoundId,
    feedUpdatedAt,
    feedAgeSeconds,
    uiMultiplier: entry.uiMultiplier.valueRaw,
    dexSpotPriceUsdg,
    executableQuote,
    premiumBps,
    poolTvlUsdgSide: null,
    tradingHalt: entry.tradingHaltAtVerification,
    pendingCorporateAction: entry.corporateAction.pending,
    session: sessionAt(now),
    notes,
  };
}
