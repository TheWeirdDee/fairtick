import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address } from "viem";

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
    protocol: "uniswapV3";
    address: Address;
    feeTier: number;
    token0: { address: Address; symbol: string };
    token1: { address: Address; symbol: string };
    quoteToken: "USDG" | "WETH";
    selectionRationale: string;
    verifiedAtBlock: string;
  };
  corporateAction: {
    pending: boolean;
    type?: string;
    status?: string;
    processDate?: string;
    rate?: string;
    source: string;
  };
  tradingHaltAtVerification: boolean;
}

export interface Registry {
  chainId: number;
  network: string;
  verifiedAt: string;
  verifiedAtBlock: string;
  core: Record<string, { address?: Address; decimals?: number; symbol?: string; source: string }>;
  symbols: Record<string, RegistrySymbolEntry>;
}

let cached: Registry | null = null;

export function loadRegistry(): Registry {
  if (!cached) {
    const path = join(process.cwd(), "data", "registry.json");
    cached = JSON.parse(readFileSync(path, "utf8")) as Registry;
  }
  return cached;
}

export function getVerifiedSymbol(symbol: string): RegistrySymbolEntry {
  const registry = loadRegistry();
  const entry = registry.symbols[symbol];
  if (!entry || entry.status !== "verified") {
    throw new Error(
      `Symbol "${symbol}" is not a verified entry in data/registry.json. FairTick v1 refuses to trade unverified symbols rather than guess addresses.`,
    );
  }
  return entry;
}

export function listTradeableSymbols(): string[] {
  const registry = loadRegistry();
  return Object.entries(registry.symbols)
    .filter(([, v]) => v.status === "verified")
    .map(([k]) => k);
}
