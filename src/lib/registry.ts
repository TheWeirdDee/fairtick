import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Address } from "viem";
import { activeNetwork, MAINNET_CORE_ADDRESSES as CORE_ADDRESSES } from "./network.js";

export interface RegistrySymbolEntry {
  status: "verified" | "unverified";
  token: { address: Address; decimals: number; symbol: string; name: string; source: string };
  uiMultiplier: { valueRaw: string; valueDecimal: number; source: string; note: string };
  feed: {
    proxyAddress: Address;
    aggregatorAddress: Address;
    decimals: number;
    description: string;
    heartbeatSeconds: number;
    source: string;
  };
  pool: {
    protocol: "uniswapV3" | "fairtickDemoPool";
    address: Address;
    feeTier: number;
    token0: { address: Address; symbol: string };
    token1: { address: Address; symbol: string };
    quoteToken: "USDG" | "WETH";
    selectionRationale: string;
    verifiedAtBlock: string;
  };
  corporateAction: {
    pending: boolean | null;
    type?: string;
    status?: string;
    processDate?: string;
    rate?: string;
    source: string;
  };
  tradingHaltAtVerification: boolean | null;
}

export interface Registry {
  chainId: number;
  network: string;
  verifiedAt: string;
  verifiedAtBlock: string;
  core: Record<string, { address?: Address; decimals?: number; symbol?: string; source: string }>;
  symbols: Record<string, RegistrySymbolEntry>;
  /** Present only in the testnet demo registry. */
  demo?: { mock: true; notice: string; referencePriceUsd: string; deployer: Address; contracts: Record<string, Address> };
}

const cache = new Map<string, Registry>();

/** Every address in a registry, for the "never reuse mainnet addresses" guard. */
function addressesIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) out.push(value.toLowerCase());
  else if (value && typeof value === "object") for (const v of Object.values(value)) addressesIn(v, out);
  return out;
}

/** Testnet registries must be self-describing mocks on 46630 and share no address with mainnet. */
export function assertTestnetRegistry(registry: Registry, mainnet: Registry): void {
  if (registry.chainId !== 46630) throw new Error(`TESTNET_REGISTRY_CHAIN_MISMATCH:${registry.chainId}`);
  if (registry.demo?.mock !== true) throw new Error("TESTNET_REGISTRY_NOT_LABELED_MOCK");
  const forbidden = new Set([...addressesIn(CORE_ADDRESSES), ...addressesIn(mainnet)]);
  const reused = addressesIn({ core: registry.core, symbols: registry.symbols, demo: registry.demo }).filter(a => forbidden.has(a));
  if (reused.length) throw new Error(`TESTNET_REGISTRY_REUSES_MAINNET_ADDRESS:${[...new Set(reused)].join(",")}`);
  for (const key of ["usdg", "router", "quoter"]) if (!registry.core[key]?.address) throw new Error(`TESTNET_REGISTRY_MISSING_${key.toUpperCase()}`);
}

function read(path: string): Registry {
  const absolute = resolve(process.cwd(), path);
  let registry = cache.get(absolute);
  if (!registry) {
    registry = JSON.parse(readFileSync(absolute, "utf8")) as Registry;
    cache.set(absolute, registry);
  }
  return registry;
}

export function loadRegistry(): Registry {
  const net = activeNetwork();
  const registry = read(net.registryPath);
  if (registry.chainId !== net.chainId) throw new Error(`REGISTRY_CHAIN_MISMATCH: ${net.registryPath} is for ${registry.chainId}, active network is ${net.chainId}`);
  if (net.name === "testnet") assertTestnetRegistry(registry, read("data/registry.json"));
  return registry;
}

export function getVerifiedSymbol(symbol: string): RegistrySymbolEntry {
  const registry = loadRegistry();
  const entry = registry.symbols[symbol];
  if (!entry || entry.status !== "verified") {
    throw new Error(
      `Symbol "${symbol}" is not a verified entry in ${activeNetwork().registryPath}. FairTick refuses to trade unverified symbols rather than guess addresses.`,
    );
  }
  return entry;
}

/** Quote token, router and quoter for the active network. Testnet values come only from its own registry. */
export function routeContracts(): { usdg: Address; router: Address; quoter: Address } {
  const net = activeNetwork();
  if (net.name === "mainnet") {
    return { usdg: CORE_ADDRESSES.usdg, router: CORE_ADDRESSES.uniswapV3SwapRouter02, quoter: CORE_ADDRESSES.uniswapV3QuoterV2 };
  }
  const core = loadRegistry().core;
  return { usdg: core.usdg!.address!, router: core.router!.address!, quoter: core.quoter!.address! };
}

export function listTradeableSymbols(): string[] {
  const registry = loadRegistry();
  return Object.entries(registry.symbols)
    .filter(([, v]) => v.status === "verified")
    .map(([k]) => k);
}
