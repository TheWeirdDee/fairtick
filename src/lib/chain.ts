import "./env.js";
import { createPublicClient, http, type Chain } from "viem";
import { activeNetwork, MAINNET_CHAIN_ID, MAINNET_CORE_ADDRESSES } from "./network.js";

export const ROBINHOOD_CHAIN_ID = MAINNET_CHAIN_ID;

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
// Mainnet only: none but Multicall3 has code on testnet 46630 (checked 2026-09-26).
export const CORE_ADDRESSES = MAINNET_CORE_ADDRESSES;

export const USDG_DECIMALS = 6;

/** The active network's chain definition (mainnet unless FAIRTICK_NETWORK=testnet). */
export function activeChain(): Chain {
  const net = activeNetwork();
  if (net.name === "mainnet") return robinhoodChain;
  return {
    id: net.chainId,
    name: net.label,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
    testnet: true,
  };
}

const clients = new Map<string, ReturnType<typeof createPublicClient>>();

export function getPublicClient() {
  const chain = activeChain();
  const url = chain.rpcUrls.default.http[0]!;
  const key = `${chain.id}:${url}`;
  let client = clients.get(key);
  if (!client) {
    client = createPublicClient({ chain, transport: http(url, { timeout: 15_000, retryCount: 1 }) });
    clients.set(key, client);
  }
  return client;
}

export async function assertChainId(): Promise<void> {
  const client = getPublicClient();
  const expected = activeNetwork().chainId;
  const chainId = await client.getChainId();
  if (chainId !== expected) {
    throw new Error(
      `Chain ID mismatch: expected ${expected} (${activeNetwork().label}), got ${chainId}. Refusing to proceed — never sign or quote against the wrong chain.`,
    );
  }
}
