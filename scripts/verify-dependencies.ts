import "../src/lib/env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseAbi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CORE_ADDRESSES, getPublicClient } from "../src/lib/chain.js";
import { getVerifiedSymbol } from "../src/lib/registry.js";
import { getMarketSnapshot } from "../src/engine/quote.js";
import { requestPlan } from "../src/engine/servPlanner.js";

const client = getPublicClient();
const entry = getVerifiedSymbol("NVDA");
const report: Record<string, unknown> = {
  observedAt: new Date().toISOString(), mode: "live_read_only", inputUsdgBaseUnits: "25000000",
  credentialsPresent: Object.fromEntries(["SERV_API_KEY", "RH_PRIVATE_KEY", "RH_SENDER_ADDRESS", "RH_RPC_URL", "DATABASE_URL", "DATABASE_PATH", "OPERATOR_SECRET"].map(k => [k, Boolean(process.env[k])])),
  sources: ["https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood", "https://docs.robinhood.com/chain/stock-token-apis/", "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments", "https://docs.openserv.ai/serv-reasoning/sdk-integration", "https://docs.openserv.ai/serv-reasoning/tools"],
  assumptions: ["USDG/USD parity for reference comparison", "Quoter gas is not total router/L2 transaction gas", "No signing, approvals, state overrides or broadcasts"],
};
const sourceUrls = {
  assets: "https://api.robinhood.com/rhj/assets",
  feeds: "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json",
  corporateActions: "https://api.robinhood.com/rhj/corporate-actions",
  uniswapDeployments: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-robinhood-chain-deployments",
  servModels: "https://docs.openserv.ai/serv-reasoning/models.md",
};
report.sourceChecks = await Promise.all(Object.entries(sourceUrls).map(async ([name, url]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = await response.text();
    const common = { name, url, checkedAt: new Date().toISOString(), httpStatus: response.status, sha256: createHash("sha256").update(body).digest("hex") };
    if (!response.ok) return common;
    if (name === "assets") {
      const asset = JSON.parse(body).assets?.find((a: { tokenSymbol?: string }) => a.tokenSymbol === "NVDA");
      return { ...common, selected: asset ?? null, registryMatches: asset?.deployments?.some((d: { chainId: number; contractAddress: string }) => d.chainId === 4663 && d.contractAddress.toLowerCase() === entry.token.address.toLowerCase()) ?? false };
    }
    if (name === "feeds") {
      const feed = JSON.parse(body).find((f: { docs?: { baseAsset?: string } }) => f.docs?.baseAsset === "NVDA");
      return { ...common, selected: feed ?? null, registryMatches: feed?.proxyAddress?.toLowerCase() === entry.feed.proxyAddress.toLowerCase() };
    }
    if (name === "corporateActions") return { ...common, selected: JSON.parse(body).corpActions?.filter((a: { tokenSymbol?: string }) => a.tokenSymbol === "NVDA") ?? null };
    if (name === "servModels") return { ...common, configuredModel: process.env.SERV_MODEL || "gpt-5.4-mini", configuredModelMentioned: body.includes(process.env.SERV_MODEL || "gpt-5.4-mini"), accountAccessVerified: false };
    return { ...common, quoterMentioned: body.toLowerCase().includes(CORE_ADDRESSES.uniswapV3QuoterV2.toLowerCase()), routerMentioned: body.toLowerCase().includes(CORE_ADDRESSES.uniswapV3SwapRouter02.toLowerCase()) };
  } catch { return { name, url, status: "FETCH_OR_SCHEMA_FAILED" }; }
}));
try {
  const chainId = await client.getChainId();
  report.chainId = chainId;
  if (chainId !== 4663) throw new Error("CHAIN_ID_MISMATCH");
  const block = await client.getBlock();
  report.block = { number: block.number.toString(), hash: block.hash, timestamp: Number(block.timestamp) };
  const contracts = { ...CORE_ADDRESSES, token: entry.token.address, feed: entry.feed.proxyAddress, pool: entry.pool.address };
  report.bytecode = await Promise.all(Object.entries(contracts).map(async ([name, address]) => {
    const code = await client.getBytecode({ address, blockNumber: block.number });
    return { name, address, bytes: code ? (code.length - 2) / 2 : 0 };
  }));
  const read = async (address: Address, signature: string, functionName: string, args?: readonly unknown[]) => client.readContract({ address, abi: parseAbi([signature]), functionName, args, blockNumber: block.number });
  const interfaces = await Promise.allSettled([
    read(CORE_ADDRESSES.uniswapV3SwapRouter02, "function factory() view returns (address)", "factory"),
    read(CORE_ADDRESSES.uniswapV3QuoterV2, "function factory() view returns (address)", "factory"),
    read(CORE_ADDRESSES.uniswapV3Factory, "function getPool(address,address,uint24) view returns (address)", "getPool", [CORE_ADDRESSES.usdg, entry.token.address, entry.pool.feeTier]),
    read(entry.pool.address, "function token0() view returns (address)", "token0"),
    read(entry.pool.address, "function token1() view returns (address)", "token1"),
    read(entry.pool.address, "function liquidity() view returns (uint128)", "liquidity"),
    read(CORE_ADDRESSES.usdg, "function decimals() view returns (uint8)", "decimals"),
    read(entry.token.address, "function decimals() view returns (uint8)", "decimals"),
    read(entry.feed.proxyAddress, "function description() view returns (string)", "description"),
  ]);
  report.interfaces = Object.fromEntries(["routerFactory", "quoterFactory", "factoryPool", "token0", "token1", "liquidity", "usdgDecimals", "tokenDecimals", "feedDescription"].map((name, i) => {
    const result = interfaces[i]!;
    return [name, result.status === "fulfilled" ? String(result.value) : "READ_FAILED"];
  }));
  report.snapshot = await getMarketSnapshot({ symbol: "NVDA" });
  // Short read-only investigation of staleness; no silent feed substitution.
  report.aggregatorReference = await read(entry.feed.aggregatorAddress,
    "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "latestRoundData").then(
      value => JSON.parse(JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v)),
      () => ({ status: "UNAVAILABLE" }),
    );
  const sender = process.env.RH_SENDER_ADDRESS as Address | undefined ?? (process.env.RH_PRIVATE_KEY ? privateKeyToAccount(process.env.RH_PRIVATE_KEY as `0x${string}`).address : undefined);
  if (!sender) report.simulation = { status: "BLOCKED", reason: "NO_CONFIGURED_SENDER", stateOverride: false };
  else {
    const balance = await read(CORE_ADDRESSES.usdg, "function balanceOf(address) view returns (uint256)", "balanceOf", [sender]);
    const allowance = await read(CORE_ADDRESSES.usdg, "function allowance(address,address) view returns (uint256)", "allowance", [sender, CORE_ADDRESSES.uniswapV3SwapRouter02]);
    report.sender = { address: sender, balance: String(balance), allowance: String(allowance), nativeBalance: String(await client.getBalance({ address: sender })) };
    // Diagnostic only. A minimum of one is NOT a permitted execution bound.
    try {
      await client.simulateContract({ account: sender, address: CORE_ADDRESSES.uniswapV3SwapRouter02,
        abi: parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"]),
        functionName: "exactInputSingle", args: [{ tokenIn: CORE_ADDRESSES.usdg, tokenOut: entry.token.address, fee: entry.pool.feeTier, recipient: sender, amountIn: 25000000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
      });
      report.simulation = { status: "SUCCEEDED_DIAGNOSTIC_ONLY", mandateCompliance: false, stateOverride: false };
    } catch {
      report.simulation = { status: "FAILED", insufficientBalance: BigInt(String(balance)) < 25000000n, insufficientAllowance: BigInt(String(allowance)) < 25000000n, stateOverride: false, reason: "ROUTER_SIMULATION_REVERT_OR_RPC_ERROR" };
    }
  }
} catch {
  report.chainFailure = "RPC_OR_CONTRACT_CHECK_FAILED";
}
report.serv = await requestPlan({ permittedActions: ["WAIT", "ESCALATE"], evidence: { gateA: { diagnosticOnly: true, executionAuthorized: false, snapshot: report.snapshot ?? null } } });
report.gateA = "INCOMPLETE_REVIEW_REQUIRED";
mkdirSync("data/evidence", { recursive: true });
const path = `data/evidence/gate-a-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ evidencePath: path, ...report }, null, 2));
