import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256, parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { activeNetwork, configuredSender, networkSummary, type Env } from "../src/lib/network.js";
import { assertTestnetRegistry, loadRegistry, type Registry } from "../src/lib/registry.js";
import { OrderStore, defaultDatabasePath } from "../src/orders/store.js";
import { processOrder, type TestnetExecutor, type WorkerDependencies, type ExecutionPrerequisites } from "../src/orders/worker.js";
import { allowedRoute } from "../src/orders/config.js";
import { createTestnetExecutor, nitroReceiptFee, testnetKeyAccount, testnetSigningAccount } from "../src/orders/testnet.js";
import { registryFor } from "../src/testnet/demoMarket.js";
import type { FeeEstimate } from "../src/lib/executionEvidence.js";
import type { ExecutionMandate } from "../src/engine/executionValidator.js";
import { MAINNET_CORE_ADDRESSES } from "../src/lib/network.js";
import { fixture, NOW, address, usableSnapshot, passingPrerequisites, liveTestDouble, chainFixture } from "./order-fixtures.js";

// SYNTHETIC: every market observation, planner answer, executor and chain response here is a
// test double. Real parts: network selection, key guards, registry guard, OrderStore on temporary
// SQLite files, the validator, processOrder and viem transaction signing (never broadcast).
const HASH=keccak256("0x02");
const dirs: string[] = [], stores: OrderStore[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const s of stores.splice(0)) if (s.db.open) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "fairtick-testnet-")); dirs.push(d); return d; };
const mainnetKey = generatePrivateKey(), testnetKey = generatePrivateKey();
const testnetAddress = privateKeyToAccount(testnetKey).address;
function testnetEnv(extra: Env = {}): Env {
  return { FAIRTICK_NETWORK: "testnet", FAIRTICK_TESTNET_RPC_URL: "https://rpc.testnet.chain.robinhood.com", FAIRTICK_TESTNET_EXECUTE: "true",
    RH_TESTNET_PRIVATE_KEY: testnetKey, RH_TESTNET_SENDER_ADDRESS: testnetAddress, RH_PRIVATE_KEY: mainnetKey.slice(2), RH_SENDER_ADDRESS: privateKeyToAccount(mainnetKey).address, ...extra };
}
/** Temporary SYNTHETIC testnet registry with non-mainnet addresses; selects the testnet network. */
function useTestnetRegistry(deployer = address(20)) {
  const d = tmp(), path = join(d, "registry.json");
  vi.stubEnv("FAIRTICK_NETWORK", "testnet");
  vi.stubEnv("FAIRTICK_TESTNET_RPC_URL", "http://127.0.0.1:1");
  vi.stubEnv("FAIRTICK_TESTNET_REGISTRY", path);
  writeFileSync(path, JSON.stringify(registryFor(deployer, { quote: address(11), token: address(12), feed: address(13), router: address(14), pool: address(15), quoter: address(16) }, 1n, new Date(NOW * 1000), true)));
  return { dir: d, path };
}

describe("network selection", () => {
  it("derives the Nitro total fee without adding the parent-chain subset twice", () => {
    expect(nitroReceiptFee(152274n,10000000n,15244n)).toEqual({totalFeeWei:1522740000000n,parentFeeWei:152440000000n,childComputeFeeWei:1370300000000n});
    expect(nitroReceiptFee(100n,1n,101n)).toBeNull();
    expect(nitroReceiptFee(100n,1n,null)).toBeNull();
  });
  it("defaults to mainnet and never reports execution enabled there", () => {
    const env = { FAIRTICK_TESTNET_EXECUTE: "true", RH_TESTNET_PRIVATE_KEY: testnetKey, RH_TESTNET_SENDER_ADDRESS: testnetAddress };
    expect(activeNetwork({}).chainId).toBe(4663);
    expect(networkSummary(env)).toMatchObject({ network: "mainnet", chainId: 4663, marketData: "LIVE_OFFICIAL", executionEnabled: false, defaultClosedPolicy: "WAIT" });
  });
  it("selects chain 46630 with mock labels, and labels loopback RPCs as a local devnet", () => {
    expect(activeNetwork({ FAIRTICK_NETWORK: "testnet" })).toMatchObject({ chainId: 46630, environment: "ROBINHOOD_TESTNET", marketData: "TESTNET_MOCK", symbol: "mNVDA", marketLabel: "TESTNET MOCK" });
    expect(activeNetwork({ FAIRTICK_NETWORK: "testnet", FAIRTICK_TESTNET_RPC_URL: "http://127.0.0.1:8545" })).toMatchObject({ environment: "LOCAL_DEVNET", marketLabel: "LOCAL DEVNET MOCK" });
    expect(activeNetwork({ FAIRTICK_NETWORK: "testnet" }).notice).toMatch(/mock tokens.*not market data/i);
    expect(() => activeNetwork({ FAIRTICK_NETWORK: "sepolia" })).toThrow(/mainnet" or "testnet/);
    expect(() => activeNetwork({ FAIRTICK_NETWORK: "testnet", RH_RPC_URL: "https://x", FAIRTICK_TESTNET_RPC_URL: "https://x" })).toThrow("TESTNET_RPC_EQUALS_MAINNET_RPC");
  });
  it("uses a separate sender per network and refuses the mainnet sender on testnet", () => {
    const main = privateKeyToAccount(mainnetKey).address;
    expect(configuredSender({ RH_SENDER_ADDRESS: main, RH_TESTNET_SENDER_ADDRESS: testnetAddress })).toBe(main);
    expect(configuredSender({ FAIRTICK_NETWORK: "testnet", RH_SENDER_ADDRESS: main })).toBeUndefined();
    expect(() => configuredSender({ FAIRTICK_NETWORK: "testnet", RH_SENDER_ADDRESS: main, RH_TESTNET_SENDER_ADDRESS: main.toLowerCase() })).toThrow("TESTNET_SENDER_EQUALS_MAINNET_SENDER");
  });
});

describe("testnet key guards", () => {
  it("accepts only a dedicated key on chain 46630 with the explicit execution flag", () => {
    expect(testnetSigningAccount(testnetEnv()).address).toBe(testnetAddress);
    expect(() => testnetSigningAccount(testnetEnv({ FAIRTICK_NETWORK: "mainnet" }))).toThrow("TESTNET_SIGNING_REQUIRES_FAIRTICK_NETWORK_TESTNET");
    expect(() => testnetKeyAccount(testnetEnv({ FAIRTICK_NETWORK: undefined }))).toThrow("TESTNET_SIGNING_REQUIRES_FAIRTICK_NETWORK_TESTNET");
    expect(() => testnetSigningAccount(testnetEnv({ FAIRTICK_TESTNET_EXECUTE: "1" }))).toThrow("TESTNET_EXECUTION_NOT_ENABLED");
    expect(testnetKeyAccount(testnetEnv({ FAIRTICK_TESTNET_EXECUTE: undefined })).address).toBe(testnetAddress); // deploy scripts: key checks, plus --broadcast
  });
  it("refuses the mainnet key in any spelling, and keys that control the mainnet sender", () => {
    const m = privateKeyToAccount(mainnetKey).address;
    expect(() => testnetKeyAccount(testnetEnv({ RH_TESTNET_PRIVATE_KEY: mainnetKey.toUpperCase().replace("0X", "0x"), RH_TESTNET_SENDER_ADDRESS: m }))).toThrow("TESTNET_KEY_IS_MAINNET_KEY");
    expect(() => testnetKeyAccount(testnetEnv({ RH_TESTNET_PRIVATE_KEY: mainnetKey.slice(2), RH_TESTNET_SENDER_ADDRESS: m }))).toThrow("TESTNET_KEY_IS_MAINNET_KEY");
    expect(() => testnetKeyAccount(testnetEnv({ RH_PRIVATE_KEY: undefined, RH_SENDER_ADDRESS: testnetAddress }))).toThrow("TESTNET_KEY_CONTROLS_MAINNET_SENDER");
    expect(() => testnetKeyAccount(testnetEnv({ RH_TESTNET_SENDER_ADDRESS: address(9) }))).toThrow("RH_TESTNET_SENDER_ADDRESS_DOES_NOT_MATCH_KEY");
    expect(() => testnetKeyAccount(testnetEnv({ RH_TESTNET_PRIVATE_KEY: "0x1234" }))).toThrow("RH_TESTNET_PRIVATE_KEY_MISSING_OR_MALFORMED");
  });
  it("refuses publicly known development keys except on a loopback devnet", () => {
    const dev = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", devAddress = privateKeyToAccount(dev).address;
    expect(() => testnetKeyAccount(testnetEnv({ RH_TESTNET_PRIVATE_KEY: dev, RH_TESTNET_SENDER_ADDRESS: devAddress }))).toThrow("WELL_KNOWN_DEV_KEY_ON_SHARED_TESTNET");
    expect(testnetKeyAccount(testnetEnv({ RH_TESTNET_PRIVATE_KEY: dev, RH_TESTNET_SENDER_ADDRESS: devAddress, FAIRTICK_TESTNET_RPC_URL: "http://127.0.0.1:8545" })).address).toBe(devAddress);
  });
});

describe("testnet registry and storage separation", () => {
  const mainnet = { chainId: 4663, core: {}, symbols: {} } as unknown as Registry;
  it("requires a mock-labeled 46630 registry that shares no address with mainnet", () => {
    const ok = registryFor(address(20), { quote: address(11), token: address(12), feed: address(13), router: address(14), pool: address(15), quoter: address(16) }, 1n, new Date(), false);
    expect(() => assertTestnetRegistry(ok, mainnet)).not.toThrow();
    expect(() => assertTestnetRegistry({ ...ok, chainId: 4663 }, mainnet)).toThrow("TESTNET_REGISTRY_CHAIN_MISMATCH");
    expect(() => assertTestnetRegistry({ ...ok, demo: undefined }, mainnet)).toThrow("TESTNET_REGISTRY_NOT_LABELED_MOCK");
    const reused = registryFor(address(20), { quote: MAINNET_CORE_ADDRESSES.usdg, token: address(12), feed: address(13), router: address(14), pool: address(15), quoter: address(16) }, 1n, new Date(), false);
    expect(() => assertTestnetRegistry(reused, mainnet)).toThrow(/TESTNET_REGISTRY_REUSES_MAINNET_ADDRESS:0x5fc5360d/);
  });
  it("loads the testnet route only from the testnet registry, and the mainnet route is unchanged", () => {
    const mainRoute = allowedRoute();
    expect(mainRoute).toMatchObject({ chainId: 4663, quoteToken: MAINNET_CORE_ADDRESSES.usdg, router: MAINNET_CORE_ADDRESSES.uniswapV3SwapRouter02 });
    useTestnetRegistry();
    expect(loadRegistry().demo?.mock).toBe(true);
    expect(allowedRoute()).toEqual({ chainId: 46630, token: address(12), quoteToken: address(11), pool: address(15), router: address(14), fee: 500, tokenDecimals: 18, quoteDecimals: 6 });
  });
  it("binds each database file to one chain and never shares the mainnet default", () => {
    const d = tmp(), path = join(d, "orders.db");
    new OrderStore(path, 4663).close();
    expect(() => new OrderStore(path, 46630)).toThrow(/DATABASE_NETWORK_MISMATCH/);
    expect(defaultDatabasePath({ FAIRTICK_NETWORK: "testnet" })).toMatch(/testnet/);
    expect(() => defaultDatabasePath({ FAIRTICK_NETWORK: "testnet", DATABASE_PATH: "./x.db", TESTNET_DATABASE_PATH: "./x.db" })).toThrow("TESTNET_DATABASE_MUST_BE_SEPARATE");
    const store = new OrderStore(join(d, "testnet.db"), 46630); stores.push(store);
    expect(() => store.create({ ...fixture("wrong-net").mandate, confirmedAt: NOW - 60 }, NOW)).toThrow("ROUTE_NETWORK_MISMATCH");
  });
});

const fee = (gasLimit: string, maxFee: string): FeeEstimate => ({ status: "ESTIMATED", estimatedGas: gasLimit, gasPriceWei: maxFee, pointEstimateWei: "1", gasLimit, maxFeePerGasWei: maxFee,
  feeUpperBoundWei: (BigInt(gasLimit) * BigInt(maxFee)).toString(), l1Component: { status: "UNAVAILABLE", gasUnits: null, l2BaseFeeWei: null, wei: null, l1BaseFeeEstimateWei: null }, method: "SYNTHETIC", notes: [], measuredAt: new Date(NOW * 1000).toISOString() });
const livePrereq = async (): Promise<ExecutionPrerequisites> => liveTestDouble({ ...(await passingPrerequisites()), fee: fee("100", "100"), gasUpperBoundWei: "10000" });
const proposing = async () => ({ status: "SUCCEEDED" as const, transactionAuthorized: false as const, synthetic: true, proposal: { action: "PROPOSE_EXECUTION", reason: "synthetic", evidenceIds: ["deterministic_candidate"] } });

function testnetOrder(overrides: Partial<ExecutionMandate> = {}) {
  const { dir } = useTestnetRegistry();
  vi.stubEnv("RH_TESTNET_PRIVATE_KEY",testnetKey);
  const store = new OrderStore(join(dir, "orders.db"), 46630); stores.push(store);
  const m: ExecutionMandate = { ...fixture("tn-1", "buy_now").mandate, route: allowedRoute(), budget: "25000000", partialFillAllowed: false, closedPolicy: "ALLOW", ...overrides };
  store.create(m, NOW);
  return { store, m };
}
function recordingExecutor(store: OrderStore, calls: string[], opts: { broadcastFails?: boolean; signFails?: boolean; notReady?: boolean; nonceChanges?: boolean } = {}): TestnetExecutor {
  return {
    prepare: async () => { calls.push("prepare"); const nonce = opts.nonceChanges && calls.length > 1 ? 8 : 7; return opts.notReady ? { ok: false, reason: "SYNTHETIC_NOT_READY" } : { ok: true, ready: { signer: address(5), nonce, gas: 100n, maxFeePerGas: 100n } }; },
    sign: async intent => { calls.push("sign"); expect(store.transaction(intent.id)).toBeUndefined(); if (opts.signFails) throw new Error("SYNTHETIC_SIGN_FAILURE"); return { hash: HASH as Hex, nonce: 7, raw: "0x02" }; },
    broadcast: async () => {
      calls.push("broadcast");
      // Identity must already be durable when the network sees the transaction.
      const pending = store.pending("tn-1")!;
      expect(store.transaction(pending.id)).toMatchObject({ hash: HASH, nonce: 7, chain_id: 46630 });
      if (opts.broadcastFails) throw new Error("SYNTHETIC_RPC_DOWN");
      return HASH as Hex;
    },
  };
}
function liveDeps(m: ExecutionMandate, extra: Partial<WorkerDependencies>): WorkerDependencies {
  return { now: () => NOW, mode: "live", quote: async () => liveTestDouble(usableSnapshot(m, NOW, { chainId: m.route.chainId, marketData: "TESTNET_MOCK" })), prerequisites: livePrereq, plan: proposing, chain: async () => null, marketLabel: "TESTNET MOCK", ...extra };
}

describe("testnet execution step in the worker (SYNTHETIC doubles)", () => {
  it("recovers identical signed bytes after a lost response without another proposal or reservation", async()=>{
    const {store,m}=testnetOrder(),calls:string[]=[];
    const executor=recordingExecutor(store,calls,{broadcastFails:true});
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    const intent=store.pending(m.orderId)!,ciphertext=store.signedBytes(intent.id)!;
    expect(ciphertext).not.toContain("0x02");
    calls.length=0;
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    expect(calls).toEqual(["broadcast"]);
    expect(store.get(m.orderId).reserved).toBe("25000000");
    expect(store.view(m.orderId,"operator")).not.toHaveProperty("raw");
    expect(JSON.stringify(store.view(m.orderId,"operator"))).not.toContain(ciphertext);
  });
  it("does not rebroadcast after cancellation or expiry and preserves the unknown reservation",async()=>{
    const {store,m}=testnetOrder(),calls:string[]=[];
    const executor=recordingExecutor(store,calls,{broadcastFails:true});
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    store.cancel(m.orderId,"operator",NOW);
    calls.length=0;
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    expect(calls).toEqual([]);expect(store.get(m.orderId).reserved).toBe("25000000");
  });
  it("persists included evidence without releasing a reservation before finality",async()=>{
    const {store,m}=testnetOrder(),calls:string[]=[];
    const executor=recordingExecutor(store,calls);
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    const intent=store.pending(m.orderId)!;
    const chain={...chainFixture(m,intent,HASH,7,111_000_000_000_000_000n),chainId:46630,finalized:false};
    await processOrder(store,m.orderId,liveDeps(m,{executor,chain:async()=>chain}));
    expect(store.view(m.orderId,"operator").receipts[0]).toMatchObject({finalized:false,settlementVerified:false});
    expect(store.get(m.orderId).reserved).toBe("25000000");
  });

  it("reserves, persists identity, then broadcasts; reconciles a finalized receipt with mock labels", async () => {
    const { store, m } = testnetOrder(), calls: string[] = [];
    const executor = recordingExecutor(store, calls);
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor }))).toBe("TESTNET_TRANSACTION_BROADCAST");
    expect(calls).toEqual(["prepare", "prepare", "sign", "broadcast"]);
    const view = store.view("tn-1", "operator");
    expect(view.order).toMatchObject({ status: "PENDING", reserved: "25000000", attempts: 1 });
    expect(view.snapshot).toMatchObject({ feedPriceUsd: 250, executableQuote: { effectivePriceUsdgPerToken: 249.75 }, referenceStatus: "USABLE" });
    expect(view.latestDecision).toMatchObject({ outcome: "RESERVED_FOR_TESTNET_EXECUTION", label: "SYNTHETIC PLANNER ON LIVE TESTNET MOCK MARKET DATA" });
    expect((view.events as { type: string }[]).map(e => e.type)).toEqual(["CONFIRMED", "RESERVED", "PLANNED", "TRANSACTION_IDENTIFIED", "BROADCAST"]);
    const intent = store.pending("tn-1")!;
    const chain = { ...chainFixture(m, intent, HASH, 7, 111_000_000_000_000_000n), chainId: 46630, environment: { network: "Robinhood Chain testnet (46630)", chainId: 46630, marketData: "TESTNET_MOCK" as const, notice: "mock" }, feeMethod: "SENDER_BALANCE_DELTA_ACROSS_INCLUSION_BLOCK" };
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor, chain: async () => chain }))).toBe("RECONCILED");
    const done = store.view("tn-1", "operator");
    expect(done.order).toMatchObject({ status: "COMPLETED", reserved: "0", settled: "25000000" });
    expect(done.receipts[0]).toMatchObject({ settlementVerified: true, mandateComplianceVerified: true, gasCostVerified: true, environment: { marketData: "TESTNET_MOCK", chainId: 46630 } });
    expect(done.receipts[0]!.notes.join(" ")).toMatch(/TESTNET_MOCK_MARKET_RECEIPT/);
  });
  it("upgrades a settled legacy fee receipt without planning, signing, broadcasting, or changing the fill", async () => {
    const {store,m}=testnetOrder(),calls:string[]=[];
    const executor=recordingExecutor(store,calls);
    await processOrder(store,m.orderId,liveDeps(m,{executor}));
    const intent=store.pending(m.orderId)!;
    const base={...chainFixture(m,intent,HASH,7,111_000_000_000_000_000n),chainId:46630,environment:{network:"Robinhood Chain testnet (46630)",chainId:46630,marketData:"TESTNET_MOCK" as const,notice:"mock"}};
    const legacy={...base,totalFeeWei:null,feeMethod:"PUBLIC_TESTNET_TOTAL_FEE_UNVERIFIED"};
    await processOrder(store,m.orderId,liveDeps(m,{executor,chain:async()=>legacy}));
    const before=store.view(m.orderId,"operator");
    expect(before.order.status).toBe("NEEDS_ATTENTION");
    expect(before.receipts[0]).toMatchObject({finalized:true,settlementVerified:true,gasCostVerified:false,mandateComplianceVerified:false});
    calls.length=0;
    const plan=vi.fn(proposing),chain=vi.fn(async()=>({...base,totalFeeWei:1000n,gasUsedForL1:100n,feeMethod:"ARBITRUM_NITRO_GAS_USED_TIMES_EFFECTIVE_GAS_PRICE"}));
    expect(await processOrder(store,m.orderId,liveDeps(m,{executor,plan,chain}))).toBe("REVERIFIED");
    const after=store.view(m.orderId,"operator");
    expect(calls).toEqual([]);expect(plan).not.toHaveBeenCalled();expect(chain).toHaveBeenCalledTimes(1);
    expect(after.order).toMatchObject({status:"COMPLETED",settled:"25000000",reserved:"0",received:"111000000000000000",gas_spent:"1000",fills:1,attempts:1});
    expect(after.receipts).toHaveLength(1);
    expect(after.receipts[0]).toMatchObject({gasCostVerified:true,mandateComplianceVerified:true,feeMethod:"ARBITRUM_NITRO_GAS_USED_TIMES_EFFECTIVE_GAS_PRICE"});
    expect(await processOrder(store,m.orderId,liveDeps(m,{executor,plan,chain}))).toBe("NOT_CLAIMED");
    expect(chain).toHaveBeenCalledTimes(1);expect((store.view(m.orderId,"operator").events as {type:string}[]).filter(e=>e.type==="REVERIFIED")).toHaveLength(1);
  });
  it("keeps the reservation and the known hash when the broadcast result is unknown", async () => {
    const { store, m } = testnetOrder(), calls: string[] = [];
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor: recordingExecutor(store, calls, { broadcastFails: true }) }))).toBe("TESTNET_BROADCAST_UNCONFIRMED");
    const view = store.view("tn-1", "operator");
    expect(view.order.reserved).toBe("25000000");
    expect(view.intents[0]).toMatchObject({ status: "PENDING" });
    expect(JSON.parse((view.events.at(-1) as { body: string }).body)).toMatchObject({ accepted: false, hash: HASH });
  });
  it("never releases a reservation it cannot account for when signing fails", async () => {
    const { store, m } = testnetOrder(), calls: string[] = [];
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor: recordingExecutor(store, calls, { signFails: true }) }))).toBe("RETRY_OR_RECOVERY");
    expect(calls).toEqual(["prepare", "prepare", "sign"]);
    expect(store.get("tn-1")).toMatchObject({ reserved: "25000000", status: "NEEDS_ATTENTION" });
  });
  it("does not reserve when the wallet nonce moved during inference", async () => {
    const { store, m } = testnetOrder(), calls: string[] = [];
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor: recordingExecutor(store, calls, { nonceChanges: true }) }))).toBe("EXECUTION_DISABLED_PREVIEW");
    expect(calls).toEqual(["prepare", "prepare"]);
    expect(store.get("tn-1").reserved).toBe("0");
  });
  it("falls back to a preview when the executor is not ready", async () => {
    const { store, m } = testnetOrder(), calls: string[] = [];
    expect(await processOrder(store, "tn-1", liveDeps(m, { executor: recordingExecutor(store, calls, { notReady: true }) }))).toBe("EXECUTION_DISABLED_PREVIEW");
    expect(calls).toEqual(["prepare"]);
    expect(store.get("tn-1").reserved).toBe("0");
  });
  it("never executes a mainnet route, even with an executor injected", async () => {
    const d = tmp(), store = new OrderStore(join(d, "orders.db")); stores.push(store);
    const m: ExecutionMandate = { ...fixture("tn-1", "buy_now").mandate, route: allowedRoute(), budget: "25000000", partialFillAllowed: false };
    expect(m.route.chainId).toBe(4663);
    store.create(m, NOW);
    const calls: string[] = [];
    const deps = liveDeps(m, { executor: recordingExecutor(store, calls) });
    deps.quote = async () => liveTestDouble(usableSnapshot(m, NOW));
    expect(await processOrder(store, "tn-1", deps)).toBe("EXECUTION_DISABLED_PREVIEW");
    expect(calls).toEqual([]);
    expect(store.get("tn-1").reserved).toBe("0");
  });
  it("store refuses a testnet-scoped reservation on a mainnet route even if asked directly", async () => {
    const d = tmp(), store = new OrderStore(join(d, "orders.db")); stores.push(store);
    const m: ExecutionMandate = { ...fixture("tn-1", "buy_now").mandate, route: allowedRoute(), budget: "25000000", partialFillAllowed: false };
    store.create(m, NOW);
    const evidence = liveTestDouble({ ...fixture().evidence, route: m.route });
    const lease = store.claim("tn-1", NOW)!;
    const applied = store.applyPlan("tn-1", lease, NOW, { snapshot: {}, evidence, route: m.route, signer: m.signer, versionBefore: store.orderVersion("tn-1"), plannerInput: {}, planner: { httpStatus: 200 },
      proposal: null, check: { ok: true, proposal: { action: "PROPOSE_EXECUTION", reason: "x", evidenceIds: [] } }, origin: "serv", provenance: "LIVE", plannerSynthetic: false, execution: { jobKey: "k" } });
    expect(applied.outcome).toBe("EXECUTION_DISABLED_PREVIEW");
    expect(store.get("tn-1").reserved).toBe("0");
  });
});

describe("testnet executor signing (never broadcast)", () => {
  it("signs exactly the reserved request on chain 46630 within the reserved fee bound", async () => {
    vi.stubEnv("FAIRTICK_NETWORK", "testnet");
    const env = testnetEnv();
    const executor = createTestnetExecutor(env);
    const request = { from: testnetAddress, to: address(14), chainId: 46630, value: "0", data: "0xabcdef" as Hex };
    const intent = { id: "i", request: JSON.stringify(request), gas_bound: "10000" } as Parameters<TestnetExecutor["sign"]>[0];
    const signed = await executor.sign(intent, { signer: testnetAddress, nonce: 3, gas: 100n, maxFeePerGas: 100n });
    const tx = parseTransaction(signed.raw as TransactionSerialized);
    expect(tx).toMatchObject({ chainId: 46630, to: address(14), data: "0xabcdef", nonce: 3, gas: 100n, maxFeePerGas: 100n, type: "eip1559" });
    expect(tx.maxPriorityFeePerGas ?? 0n).toBe(0n); // viem omits a zero field when parsing
    expect(await recoverTransactionAddress({ serializedTransaction: signed.raw as TransactionSerialized })).toBe(testnetAddress);
    await expect(executor.sign(intent, { signer: testnetAddress, nonce: 3, gas: 101n, maxFeePerGas: 100n })).rejects.toThrow("SIGNED_FEE_CAP_EXCEEDS_RESERVED_BOUND");
    await expect(executor.sign({ ...intent, request: JSON.stringify({ ...request, chainId: 4663 }) }, { signer: testnetAddress, nonce: 3, gas: 100n, maxFeePerGas: 100n })).rejects.toThrow("INTENT_NOT_TESTNET");
  });
});
