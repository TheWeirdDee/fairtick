import { createPublicClient, http, type Chain } from "viem";

export const ROBINHOOD_CHAIN_ID = 4663;

export const robinhoodChain: Chain = {
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
};

// Verified live against chain 4663 on 2026-09-24 at block 71464115. See DATA-CONTRACT.md.
export const CORE_ADDRESSES = {
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  uniswapV3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  uniswapV3SwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  uniswapV3QuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
} as const;

export const USDG_DECIMALS = 6;

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: robinhoodChain,
      transport: http(robinhoodChain.rpcUrls.default.http[0]),
    });
  }
  return cachedClient;
}

export async function assertChainId(): Promise<void> {
  const client = getPublicClient();
  const chainId = await client.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) {
    throw new Error(
      `Chain ID mismatch: expected ${ROBINHOOD_CHAIN_ID} (Robinhood Chain), got ${chainId}. Refusing to proceed — never sign or quote against the wrong chain.`,
    );
  }
}
