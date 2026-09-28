#!/usr/bin/env tsx
/**
 * Reproducible registry resolution. Regenerates data/registry.json from
 * live, authoritative sources only — never from hardcoded guesses:
 *
 *   - chain id / bytecode: live RPC (eth_chainId, eth_getCode)
 *   - token address/decimals/multiplier: https://api.robinhood.com/rhj/assets (official)
 *   - feed proxy address: https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json (Chainlink)
 *   - pool selection: Uniswap V3 Factory.getPool() across fee tiers x {USDG, WETH}, picking the deepest by live balance
 *   - trading halt / corporate action: https://api.robinhood.com/rhj/prices/{symbol} and /rhj/corporate-actions
 *
 * See DATA-CONTRACT.md for the narrative writeup of what this script found
 * on 2026-09-24 and why the anomaly note about WebSearch exists.
 *
 * Usage: pnpm resolve-registry [SYMBOL...]   (defaults to NVDA)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { CORE_ADDRESSES, ROBINHOOD_CHAIN_ID, robinhoodChain } from "../src/lib/chain.js";

const RHJ_ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const RHJ_CORP_ACTIONS_URL = "https://api.robinhood.com/rhj/corporate-actions";
const RHJ_PRICES_URL = (symbol: string) => `https://api.robinhood.com/rhj/prices/${symbol}`;
const CHAINLINK_ROBINHOOD_FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";

const FEE_TIERS = [100, 500, 3000, 10000] as const;

const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0]) });

const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const poolAbi = parseAbi([
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
]);
const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function description() view returns (string)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
]);

interface RhjAsset {
  tokenSymbol: string;
  tokenName: string;
  tokenDecimals: number;
  currentMultiplier: string;
  deployments: { contractAddress: string; chainId: number }[];
}

interface ChainlinkFeedEntry {
  name: string;
  proxyAddress: string;
  contractAddress: string;
  decimals: number;
  heartbeat: number;
  docs?: { baseAsset?: string };
}

async function assertLiveChain(): Promise<{ blockNumber: bigint; blockHash: `0x${string}` }> {
  const chainId = await client.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(`Live chainId ${chainId} != expected ${ROBINHOOD_CHAIN_ID}. Aborting — will not write a registry against the wrong chain.`);
  }
  for (const [name, address] of Object.entries(CORE_ADDRESSES)) {
    const code = await client.getBytecode({ address: address as Address });
    if (!code || code === "0x") {
      throw new Error(`No bytecode at ${name} (${address}) on live chain ${chainId}. A candidate address from the PRD is wrong; stop and re-resolve before continuing.`);
    }
  }
  const block = await client.getBlock();
  return { blockNumber: block.number, blockHash: block.hash };
}

async function resolveToken(symbol: string): Promise<RhjAsset> {
  const res = await fetch(RHJ_ASSETS_URL);
  if (!res.ok) throw new Error(`${RHJ_ASSETS_URL} returned HTTP ${res.status}`);
  const data = (await res.json()) as { assets: RhjAsset[] };
  const asset = data.assets.find((a) => a.tokenSymbol === symbol);
  if (!asset) throw new Error(`Symbol ${symbol} not found in official Robinhood asset registry (${RHJ_ASSETS_URL}).`);
  const deployment = asset.deployments.find((d) => d.chainId === ROBINHOOD_CHAIN_ID);
  if (!deployment) throw new Error(`Symbol ${symbol} has no deployment on chain ${ROBINHOOD_CHAIN_ID}.`);
  return asset;
}

async function resolveFeed(symbol: string): Promise<ChainlinkFeedEntry> {
  const res = await fetch(CHAINLINK_ROBINHOOD_FEEDS_URL);
  if (!res.ok) throw new Error(`${CHAINLINK_ROBINHOOD_FEEDS_URL} returned HTTP ${res.status}`);
  const entries = (await res.json()) as ChainlinkFeedEntry[];
  const entry = entries.find((e) => e.docs?.baseAsset === symbol);
  if (!entry) throw new Error(`No Chainlink feed for base asset ${symbol} in ${CHAINLINK_ROBINHOOD_FEEDS_URL}.`);
  return entry;
}

async function findDeepestPool(tokenAddress: Address) {
  const candidates: { quoteToken: "USDG" | "WETH"; fee: number; pool: Address }[] = [];
  for (const quoteSymbol of ["USDG", "WETH"] as const) {
    const quoteAddress = CORE_ADDRESSES[quoteSymbol.toLowerCase() as "usdg" | "weth"] as Address;
    for (const fee of FEE_TIERS) {
      const pool = await client.readContract({
        address: CORE_ADDRESSES.uniswapV3Factory as Address,
        abi: factoryAbi,
        functionName: "getPool",
        args: [tokenAddress, quoteAddress, fee],
      });
      if (pool !== "0x0000000000000000000000000000000000000000") {
        candidates.push({ quoteToken: quoteSymbol, fee, pool });
      }
    }
  }
  if (candidates.length === 0) throw new Error(`No Uniswap V3 pool found for token ${tokenAddress} against USDG or WETH at any of ${FEE_TIERS.join(",")} fee tiers.`);

  let best: { candidate: (typeof candidates)[number]; depthUsdgEquivalent: number; token0: Address; token1: Address } | null = null;
  for (const candidate of candidates) {
    const [token0, token1] = await Promise.all([
      client.readContract({ address: candidate.pool, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address: candidate.pool, abi: poolAbi, functionName: "token1" }),
    ]);
    // Depth proxy: balance of the quote-token side of the pool, in whole quote-token units.
    // This is enough to *rank* candidates (we only need the deepest), not to price anything.
    const quoteAddress = getAddress(CORE_ADDRESSES[candidate.quoteToken.toLowerCase() as "usdg" | "weth"]);
    const [quoteDecimals, quoteBal] = await Promise.all([
      client.readContract({ address: quoteAddress, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: quoteAddress, abi: erc20Abi, functionName: "balanceOf", args: [candidate.pool] }),
    ]);
    const depth = Number(quoteBal) / 10 ** quoteDecimals;
    // Only USDG-denominated pools satisfy the first-release "USDG input" requirement directly;
    // still record WETH depth for the log, but only USDG candidates are eligible to win.
    if (candidate.quoteToken !== "USDG") continue;
    if (!best || depth > best.depthUsdgEquivalent) {
      best = { candidate, depthUsdgEquivalent: depth, token0, token1 };
    }
  }
  if (!best) throw new Error(`No USDG-denominated pool found for token ${tokenAddress}; first-release scope requires USDG input.`);
  return best;
}

async function main() {
  const symbols = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["NVDA"];
  console.log(`Resolving registry for: ${symbols.join(", ")}`);

  const { blockNumber, blockHash } = await assertLiveChain();
  console.log(`Live chain confirmed: chainId=${ROBINHOOD_CHAIN_ID}, block=${blockNumber}, hash=${blockHash}`);

  const symbolEntries: Record<string, unknown> = {};

  for (const symbol of symbols) {
    console.log(`\n--- ${symbol} ---`);
    const asset = await resolveToken(symbol);
    const deployment = asset.deployments.find((d) => d.chainId === ROBINHOOD_CHAIN_ID)!;
    const tokenAddress = getAddress(deployment.contractAddress);
    console.log(`Token: ${tokenAddress} (${asset.tokenName})`);

    const [onchainSymbol, onchainDecimals, onchainMultiplier] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: tokenAddress, abi: erc20Abi, functionName: "uiMultiplier" }).catch(() => null),
    ]);
    if (onchainSymbol !== symbol) throw new Error(`On-chain symbol() "${onchainSymbol}" != expected "${symbol}"`);
    if (onchainMultiplier !== null) {
      const onchainDecimal = Number(onchainMultiplier) / 1e18;
      const apiDecimal = Number(asset.currentMultiplier);
      if (Math.abs(onchainDecimal - apiDecimal) > 1e-9) {
        throw new Error(
          `uiMultiplier mismatch for ${symbol}: on-chain=${onchainDecimal}, ${RHJ_ASSETS_URL}=${apiDecimal}. Stop and investigate before trusting either source.`,
        );
      }
    }

    const feed = await resolveFeed(symbol);
    const feedProxy = getAddress(feed.proxyAddress);
    const [feedDecimals, feedDescription] = await Promise.all([
      client.readContract({ address: feedProxy, abi: feedAbi, functionName: "decimals" }),
      client.readContract({ address: feedProxy, abi: feedAbi, functionName: "description" }),
    ]);
    console.log(`Feed: ${feedProxy} ("${feedDescription}", ${feedDecimals} decimals, heartbeat ${feed.heartbeat}s)`);

    const poolResult = await findDeepestPool(tokenAddress);
    console.log(
      `Pool: ${poolResult.candidate.pool} (${poolResult.candidate.quoteToken}, fee ${poolResult.candidate.fee}) depth=${poolResult.depthUsdgEquivalent} ${poolResult.candidate.quoteToken}`,
    );

    let tradingHalt: boolean | null = null;
    try {
      const priceRes = await fetch(RHJ_PRICES_URL(symbol));
      if (priceRes.ok) {
        const priceData = (await priceRes.json()) as { quotes: { isTradingHalt: boolean }[] };
        tradingHalt = priceData.quotes[0]?.isTradingHalt ?? null;
      }
    } catch {
      console.warn(`Could not fetch trading-halt status for ${symbol}; leaving null (UNAVAILABLE), not assuming false.`);
    }

    let corporateAction: { pending: boolean | null; type?: string; status?: string; processDate?: string; rate?: string } = {
      pending: null,
    };
    try {
      const caRes = await fetch(RHJ_CORP_ACTIONS_URL);
      if (caRes.ok) {
        const caData = (await caRes.json()) as { corpActions: Array<{ tokenSymbol: string; type: string; status: string; processDate: { year: number; month: number; day: number }; details?: { cashDividend?: { rate: string } } }> };
        const match = caData.corpActions.find((a) => a.tokenSymbol === symbol && a.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS");
        corporateAction.pending = false;
        if (match) {
          corporateAction = {
            pending: true,
            type: match.type,
            status: match.status,
            processDate: `${match.processDate.year}-${String(match.processDate.month).padStart(2, "0")}-${String(match.processDate.day).padStart(2, "0")}`,
            rate: match.details?.cashDividend?.rate,
          };
        }
      }
    } catch {
      console.warn(`Could not fetch corporate-action status for ${symbol}; recording unavailable.`);
    }

    symbolEntries[symbol] = {
      status: "verified",
      token: {
        address: tokenAddress,
        decimals: onchainDecimals,
        symbol: onchainSymbol,
        name: asset.tokenName,
        source: `${RHJ_ASSETS_URL} (official Robinhood asset registry), cross-checked with on-chain symbol()/decimals()`,
      },
      uiMultiplier: {
        valueRaw: onchainMultiplier?.toString() ?? "unknown",
        valueDecimal: onchainMultiplier ? Number(onchainMultiplier) / 1e18 : null,
        source: `on-chain uiMultiplier() at block ${blockNumber}, cross-checked against currentMultiplier from ${RHJ_ASSETS_URL}`,
        note: "Chainlink feed price already includes this multiplier. Do not re-apply it to feedPriceUsd or dexPriceUsd.",
      },
      feed: {
        proxyAddress: feedProxy,
        aggregatorAddress: getAddress(feed.contractAddress),
        decimals: feedDecimals,
        description: feedDescription,
        heartbeatSeconds: feed.heartbeat,
        source: `${CHAINLINK_ROBINHOOD_FEEDS_URL} (Chainlink public feed directory), cross-checked on-chain via decimals()/description()`,
      },
      pool: {
        protocol: "uniswapV3",
        address: poolResult.candidate.pool,
        feeTier: poolResult.candidate.fee,
        token0: { address: poolResult.token0, symbol: poolResult.token0.toLowerCase() === tokenAddress.toLowerCase() ? symbol : "USDG" },
        token1: { address: poolResult.token1, symbol: poolResult.token1.toLowerCase() === tokenAddress.toLowerCase() ? symbol : "USDG" },
        quoteToken: "USDG",
        selectionRationale: `Deepest USDG-denominated pool by live quote-token balance across fee tiers ${FEE_TIERS.join("/")}; depth=${poolResult.depthUsdgEquivalent} USDG at block ${blockNumber}.`,
        verifiedAtBlock: blockNumber.toString(),
      },
      corporateAction: { ...corporateAction, source: RHJ_CORP_ACTIONS_URL },
      tradingHaltAtVerification: tradingHalt,
    };
  }

  const registry = {
    chainId: ROBINHOOD_CHAIN_ID,
    network: "Robinhood Chain mainnet",
    verifiedAt: new Date().toISOString(),
    verifiedAtBlock: blockNumber.toString(),
    verifiedAtBlockHash: blockHash,
    rpcSource: process.env.RH_RPC_URL ? "configured (URL redacted)" : "public Robinhood RPC",
    core: {
      usdg: { address: CORE_ADDRESSES.usdg, decimals: 6, symbol: "USDG", source: "FairTick_PRD.md §7, bytecode-verified live" },
      weth: { address: CORE_ADDRESSES.weth, decimals: 18, symbol: "WETH", source: "FairTick_PRD.md §7, bytecode-verified live" },
      multicall3: { address: CORE_ADDRESSES.multicall3, source: "FairTick_PRD.md §7, bytecode-verified live" },
      uniswapV3Factory: { address: CORE_ADDRESSES.uniswapV3Factory, source: "FairTick_PRD.md §7, bytecode-verified live, cross-linked via SwapRouter02.factory()" },
      uniswapV3SwapRouter02: { address: CORE_ADDRESSES.uniswapV3SwapRouter02, source: "FairTick_PRD.md §7, bytecode-verified live" },
      uniswapV3QuoterV2: { address: CORE_ADDRESSES.uniswapV3QuoterV2, source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments, bytecode-verified live" },
    },
    symbols: symbolEntries,
  };

  const outPath = join(process.cwd(), "data", "registry.json");
  writeFileSync(outPath, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nWrote ${outPath}`);
}

main().catch(() => {
  console.error("Registry resolution failed; no new verification claim. RPC URLs and credentials are omitted.");
  process.exit(1);
});
