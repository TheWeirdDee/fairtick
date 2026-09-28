import "./env.js";

/**
 * Which chain this process serves. Mainnet is the default and is unchanged:
 * official assets, live official market data, signing disabled. "testnet" is a
 * separate demo configuration on Robinhood Chain testnet (46630) over clearly
 * labeled MOCK contracts. The two never share a registry, database, sender or key.
 */
export const MAINNET_CHAIN_ID = 4663;
export const TESTNET_CHAIN_ID = 46630;
export type SupportedChainId = typeof MAINNET_CHAIN_ID | typeof TESTNET_CHAIN_ID;

/** Robinhood Chain mainnet (4663) contracts; re-exported by chain.ts as CORE_ADDRESSES. */
export const MAINNET_CORE_ADDRESSES = {
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  uniswapV3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  uniswapV3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  uniswapV3QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
} as const;

/** Plain environment record (process.env or a test double). */
export type Env = Readonly<Record<string, string | undefined>>;

export type NetworkName = "mainnet" | "testnet";
export type MarketDataClass = "LIVE_OFFICIAL" | "TESTNET_MOCK";

export interface NetworkConfig {
  name: NetworkName;
  chainId: SupportedChainId;
  rpcUrl: string;
  explorerUrl: string;
  /** Human label shown in the UI, decisions and receipts. */
  label: string;
  /** "LOCAL_DEVNET" when the testnet configuration points at a loopback RPC (e.g. anvil --chain-id 46630). */
  environment: "ROBINHOOD_MAINNET" | "ROBINHOOD_TESTNET" | "LOCAL_DEVNET";
  marketData: MarketDataClass;
  /** Inserted into decision labels, e.g. "REAL SERV CALL ON LIVE TESTNET MOCK MARKET DATA". Empty on mainnet. */
  marketLabel: string;
  symbol: string;
  registryPath: string;
  senderEnv: "RH_SENDER_ADDRESS" | "RH_TESTNET_SENDER_ADDRESS";
  notice: string | null;
}

const MOCK_NOTICE =
  "TESTNET DEMO: mock tokens (mUSDG, mNVDA), an operator-set mock price and operator-seeded (controlled) liquidity. Not USDG, not a Robinhood stock token, not Chainlink, not Uniswap, not market data. Tokens have no value.";

export function isLoopbackRpc(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** Resolved on every call so scripts and tests can select a network before use. */
export function activeNetwork(env: Env = process.env): NetworkConfig {
  const requested = (env.FAIRTICK_NETWORK ?? "mainnet").trim().toLowerCase();
  if (requested === "mainnet") {
    return {
      name: "mainnet", chainId: MAINNET_CHAIN_ID,
      rpcUrl: env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
      explorerUrl: "https://robinhoodchain.blockscout.com",
      label: "Robinhood Chain mainnet (4663)", environment: "ROBINHOOD_MAINNET",
      marketData: "LIVE_OFFICIAL", marketLabel: "", symbol: "NVDA",
      registryPath: "data/registry.json", senderEnv: "RH_SENDER_ADDRESS", notice: null,
    };
  }
  if (requested === "testnet") {
    const rpcUrl = env.FAIRTICK_TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
    // The mainnet RPC override must never leak into the testnet configuration.
    if (env.RH_RPC_URL && rpcUrl === env.RH_RPC_URL) throw new Error("TESTNET_RPC_EQUALS_MAINNET_RPC");
    const local = isLoopbackRpc(rpcUrl);
    return {
      name: "testnet", chainId: TESTNET_CHAIN_ID, rpcUrl,
      explorerUrl: local ? "" : "https://explorer.testnet.chain.robinhood.com",
      label: local ? "LOCAL DEVNET (chain id 46630, not Robinhood testnet)" : "Robinhood Chain testnet (46630)",
      environment: local ? "LOCAL_DEVNET" : "ROBINHOOD_TESTNET",
      marketData: "TESTNET_MOCK", marketLabel: local ? "LOCAL DEVNET MOCK" : "TESTNET MOCK", symbol: "mNVDA",
      registryPath: env.FAIRTICK_TESTNET_REGISTRY ?? "data/testnet/registry.testnet.json",
      senderEnv: "RH_TESTNET_SENDER_ADDRESS", notice: MOCK_NOTICE,
    };
  }
  throw new Error(`FAIRTICK_NETWORK must be "mainnet" or "testnet", got "${requested}"`);
}

/** Public sender for the active network. The mainnet sender is never used on testnet. */
export function configuredSender(env: Env = process.env): `0x${string}` | undefined {
  const net = activeNetwork(env);
  const value = env[net.senderEnv];
  if (!value) return undefined;
  if (net.name === "testnet" && env.RH_SENDER_ADDRESS && value.toLowerCase() === env.RH_SENDER_ADDRESS.toLowerCase()) {
    throw new Error("TESTNET_SENDER_EQUALS_MAINNET_SENDER");
  }
  return value as `0x${string}`;
}

/** Mainnet: always false in this build. Testnet: only with the explicit flag. */
export function testnetExecutionRequested(env: Env = process.env): boolean {
  return activeNetwork(env).name === "testnet" && env.FAIRTICK_TESTNET_EXECUTE === "true";
}

/** A short, UI-safe summary; booleans only for credentials. */
export function networkSummary(env: Env = process.env) {
  const net = activeNetwork(env);
  return {
    network: net.name, chainId: net.chainId, networkLabel: net.label, environment: net.environment,
    marketData: net.marketData, symbol: net.symbol, notice: net.notice, explorerUrl: net.explorerUrl || null,
    executionEnabled: net.name === "testnet" && testnetExecutionRequested(env) && Boolean(env.RH_TESTNET_PRIVATE_KEY) && Boolean(env.RH_TESTNET_SENDER_ADDRESS),
    // Session policy of the demo mandate: the mock market has no exchange hours, but the
    // validator still classifies the real US session; demo mandates opt in with ALLOW.
    defaultClosedPolicy: net.name === "testnet" ? "ALLOW" as const : "WAIT" as const,
  };
}
