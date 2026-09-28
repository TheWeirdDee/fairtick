import { createPublicClient, http, keccak256, parseAbi, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { activeNetwork, isLoopbackRpc, testnetExecutionRequested, TESTNET_CHAIN_ID, type Env } from "../lib/network.js";
import { getPublicClient } from "../lib/chain.js";
import { getVerifiedSymbol } from "../lib/registry.js";
import { getMarketSnapshot } from "../engine/quote.js";
import { requestPlan } from "../engine/servPlanner.js";
import type { ChainEvidence } from "../engine/receipt.js";
import type { ExecutionMandate } from "../engine/executionValidator.js";
import type { OrderStore } from "./store.js";
import { measureLivePrerequisites, type ExecutionReady, type TestnetExecutor, type WorkerDependencies } from "./worker.js";

/**
 * TESTNET DEMO ONLY. Everything here refuses to act unless the process serves
 * chain 46630 with FAIRTICK_TESTNET_EXECUTE=true and a dedicated testnet key
 * that is neither the mainnet key nor controls the mainnet sender. The key is
 * never printed, logged or persisted by this module.
 */

// Well-known development keys (anvil/hardhat mnemonic, first accounts). Public
// knowledge: acceptable on a loopback devnet, never on the shared testnet.
const WELL_KNOWN_DEV_ADDRESSES = new Set([
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc", "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
]);

export function normalizeKey(key: string | undefined): Hex | null {
  if (!key) return null;
  const k = key.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(k) ? (`0x${k}` as Hex) : null;
}

/** The dedicated testnet key, after every separation check. Used by the deploy/price scripts
 * (which also require an explicit --broadcast) and by the order executor. Every refusal is a
 * thrown error with a stable code; nothing secret is included. */
export function testnetKeyAccount(env: Env = process.env): PrivateKeyAccount {
  const net = activeNetwork(env);
  if (net.name !== "testnet" || net.chainId !== TESTNET_CHAIN_ID) throw new Error("TESTNET_SIGNING_REQUIRES_FAIRTICK_NETWORK_TESTNET");
  const key = normalizeKey(env.RH_TESTNET_PRIVATE_KEY);
  if (!key) throw new Error("RH_TESTNET_PRIVATE_KEY_MISSING_OR_MALFORMED");
  const mainnetKey = normalizeKey(env.RH_PRIVATE_KEY);
  if (mainnetKey && mainnetKey === key) throw new Error("TESTNET_KEY_IS_MAINNET_KEY");
  const account = privateKeyToAccount(key);
  const address = account.address.toLowerCase();
  if (env.RH_SENDER_ADDRESS && env.RH_SENDER_ADDRESS.toLowerCase() === address) throw new Error("TESTNET_KEY_CONTROLS_MAINNET_SENDER");
  if (mainnetKey && privateKeyToAccount(mainnetKey).address.toLowerCase() === address) throw new Error("TESTNET_KEY_IS_MAINNET_KEY");
  if (!env.RH_TESTNET_SENDER_ADDRESS || env.RH_TESTNET_SENDER_ADDRESS.toLowerCase() !== address) throw new Error("RH_TESTNET_SENDER_ADDRESS_DOES_NOT_MATCH_KEY");
  if (!isLoopbackRpc(net.rpcUrl) && WELL_KNOWN_DEV_ADDRESSES.has(address)) throw new Error("WELL_KNOWN_DEV_KEY_ON_SHARED_TESTNET");
  return account;
}

/** Order execution additionally requires FAIRTICK_TESTNET_EXECUTE=true. */
export function testnetSigningAccount(env: Env = process.env): PrivateKeyAccount {
  if (activeNetwork(env).name !== "testnet") throw new Error("TESTNET_SIGNING_REQUIRES_FAIRTICK_NETWORK_TESTNET");
  if (!testnetExecutionRequested(env)) throw new Error("TESTNET_EXECUTION_NOT_ENABLED");
  return testnetKeyAccount(env);
}

/** Re-reads the RPC's chain id; used before preparing and again before broadcasting. */
export async function assertTestnetRpc(): Promise<void> {
  const id = await getPublicClient().getChainId();
  if (id !== TESTNET_CHAIN_ID) throw new Error(`TESTNET_RPC_CHAIN_MISMATCH:${id}`);
  const net=activeNetwork();
  if(net.environment==='LOCAL_DEVNET')return;
  // Compare canonical finalized identity against the documented public endpoint.
  // A private fork can reuse 46630; the configured endpoint alone is not proof.
  const reference=createPublicClient({transport:http('https://rpc.testnet.chain.robinhood.com',{timeout:15000,retryCount:1})});
  const block=await reference.getBlock({blockTag:'finalized'});
  const configured=await getPublicClient().getBlock({blockNumber:block.number});
  if(configured.hash!==block.hash)throw new Error('TESTNET_PUBLIC_BLOCK_IDENTITY_MISMATCH');
  const code=await getPublicClient().getBytecode({address:'0x77bF00A6A90c600f214b34BAFBB7918c0cF113A8'});
  if(!code||code==='0x')throw new Error('TESTNET_CANONICAL_GATEWAY_MISSING');
}

export function createTestnetExecutor(env: Env = process.env): TestnetExecutor {
  const account = testnetSigningAccount(env);
  return {
    async prepare(m: ExecutionMandate, fee) {
      try {
        testnetSigningAccount(env);
        if (m.route.chainId !== TESTNET_CHAIN_ID) return { ok: false, reason: "ROUTE_NOT_TESTNET" };
        if (m.signer.toLowerCase() !== account.address.toLowerCase()) return { ok: false, reason: "MANDATE_SIGNER_IS_NOT_TESTNET_KEY" };
        if (!fee || fee.status !== "ESTIMATED" || !fee.gasLimit || !fee.maxFeePerGasWei) return { ok: false, reason: "FEE_BOUND_UNAVAILABLE" };
        await assertTestnetRpc();
        const client = getPublicClient();
        const [pending, latest] = await Promise.all([
          client.getTransactionCount({ address: account.address, blockTag: "pending" }),
          client.getTransactionCount({ address: account.address, blockTag: "latest" }),
        ]);
        // An in-flight transaction this store does not know about would make the nonce ambiguous.
        if (pending !== latest) return { ok: false, reason: "WALLET_HAS_UNKNOWN_PENDING_TRANSACTION" };
        const ready: ExecutionReady = { signer: account.address, nonce: latest, gas: BigInt(fee.gasLimit), maxFeePerGas: BigInt(fee.maxFeePerGasWei) };
        return { ok: true, ready };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message.split("\n")[0]! : "PREPARE_FAILED" };
      }
    },
    async sign(intent, ready) {
      const request = JSON.parse(intent.request) as { from: string; to: Address; chainId: number; value: string; data: Hex };
      if (request.chainId !== TESTNET_CHAIN_ID) throw new Error("INTENT_NOT_TESTNET");
      if (request.value !== "0") throw new Error("INTENT_HAS_VALUE");
      if (request.from.toLowerCase() !== account.address.toLowerCase() || ready.signer.toLowerCase() !== account.address.toLowerCase()) throw new Error("INTENT_SIGNER_MISMATCH");
      // The signed caps must stay within the gas bound the validator reserved.
      if (ready.gas * ready.maxFeePerGas > BigInt(intent.gas_bound)) throw new Error("SIGNED_FEE_CAP_EXCEEDS_RESERVED_BOUND");
      const raw = await account.signTransaction({
        type: "eip1559", chainId: TESTNET_CHAIN_ID, nonce: ready.nonce, to: request.to, data: request.data, value: 0n,
        gas: ready.gas, maxFeePerGas: ready.maxFeePerGas, maxPriorityFeePerGas: 0n,
      });
      return { hash: keccak256(raw), nonce: ready.nonce, raw };
    },
    async broadcast(raw) {
      testnetSigningAccount(env);
      await assertTestnetRpc();
      return getPublicClient().sendRawTransaction({ serializedTransaction: raw });
    },
  };
}

const FEED_ROUND_ABI = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]);

/** Robinhood testnet uses Nitro receipt semantics: gasUsed already contains the
 * parent-chain posting gas expressed in child-chain gas units. Multiplying the
 * full gasUsed by effectiveGasPrice yields the transaction total; gasUsedForL1
 * is disclosed for decomposition and must not be added again. */
export function nitroReceiptFee(gasUsed:bigint,effectiveGasPrice:bigint,gasUsedForL1:bigint|null) {
  if(gasUsed<0n||effectiveGasPrice<0n||gasUsedForL1===null||gasUsedForL1<0n||gasUsedForL1>gasUsed)return null;
  return {totalFeeWei:gasUsed*effectiveGasPrice,parentFeeWei:gasUsedForL1*effectiveGasPrice,childComputeFeeWei:(gasUsed-gasUsedForL1)*effectiveGasPrice};
}

/** Inclusion reference and transaction-specific fee evidence are cached by
 * canonical block identity. Legacy unverified fee measurements are upgraded. */
export function testnetChainEvidence(store: OrderStore) {
  return async (hash: string, m: ExecutionMandate): Promise<ChainEvidence | null> => {
    const net = activeNetwork();
    if (net.chainId !== TESTNET_CHAIN_ID || m.route.chainId !== TESTNET_CHAIN_ID) throw new Error("CHAIN_MISMATCH");
    await assertTestnetRpc();
    const c = getPublicClient();
    const receipt = await c.getTransactionReceipt({ hash: hash as Hash }).catch(() => null);
    if (!receipt) return null;
    const [tx, block, finalized] = await Promise.all([
      c.getTransaction({ hash: hash as Hash }),
      c.getBlock({ blockNumber: receipt.blockNumber, includeTransactions: true }),
      c.getBlock({ blockTag: "finalized" }),
    ]);
    const rawGasUsedForL1=(receipt as unknown as {gasUsedForL1?:bigint|string}).gasUsedForL1;
    const gasUsedForL1=typeof rawGasUsedForL1==="bigint"?rawGasUsedForL1:typeof rawGasUsedForL1==="string"&&/^0x[0-9a-f]+$/i.test(rawGasUsedForL1)?BigInt(rawGasUsedForL1):null;
    let cached = store.inclusionMeasurement(receipt.transactionHash, receipt.blockHash) as { totalFeeWei: string | null; feeMethod: string; gasUsedForL1?:string|null; parentFeeWei?:string|null; childComputeFeeWei?:string|null; referenceAtInclusion: unknown } | null;
    if (!cached || cached.referenceAtInclusion == null || ["SENDER_BALANCE_DELTA_ACROSS_INCLUSION_BLOCK","PUBLIC_TESTNET_TOTAL_FEE_UNVERIFIED"].includes(cached.feeMethod)) {
      const local = net.environment === "LOCAL_DEVNET";
      const nitro=!local?nitroReceiptFee(receipt.gasUsed,receipt.effectiveGasPrice,gasUsedForL1):null;
      const totalFeeWei = local ? receipt.gasUsed * receipt.effectiveGasPrice : nitro?.totalFeeWei??null;
      const feeMethod = local ? "LOCAL_EVM_RECEIPT_GAS_TIMES_PRICE" : nitro ? "ARBITRUM_NITRO_GAS_USED_TIMES_EFFECTIVE_GAS_PRICE" : "PUBLIC_TESTNET_TOTAL_FEE_UNVERIFIED";
      let referenceAtInclusion: unknown = cached?.referenceAtInclusion ?? null;
      if (referenceAtInclusion === null) {
        try {
          const entry = getVerifiedSymbol(net.symbol);
          const round = await c.readContract({ address: entry.feed.proxyAddress, abi: FEED_ROUND_ABI, functionName: "latestRoundData", blockNumber: receipt.blockNumber });
          referenceAtInclusion = { feed: entry.feed.proxyAddress, mock: true, block: receipt.blockNumber.toString(), blockHash: receipt.blockHash, round: round.map(String) };
        } catch { /* Retry missing reads next time, including after restart. */ }
      }
      cached = { totalFeeWei: totalFeeWei?.toString() ?? null, feeMethod, gasUsedForL1:gasUsedForL1?.toString()??null,parentFeeWei:nitro?.parentFeeWei.toString()??null,childComputeFeeWei:nitro?.childComputeFeeWei.toString()??null,referenceAtInclusion };
      store.recordInclusionMeasurement(receipt.transactionHash, receipt.blockHash, cached, Math.floor(Date.now() / 1000));
    }
    return {
      chainId: TESTNET_CHAIN_ID, transactionHash: receipt.transactionHash, from: tx.from, to: tx.to ?? "", input: tx.input, nonce: tx.nonce, value: tx.value,
      status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, blockTimestamp: Number(block.timestamp), canonicalBlockHash: block.hash,
      finalized: finalized.number >= receipt.blockNumber, gasUsed: receipt.gasUsed, effectiveGasPrice: receipt.effectiveGasPrice,
      gasUsedForL1,
      totalFeeWei: cached.totalFeeWei === null ? null : BigInt(cached.totalFeeWei), logs: receipt.logs, referenceAtInclusion: cached.referenceAtInclusion,
      environment: { network: net.label, chainId: TESTNET_CHAIN_ID, marketData: "TESTNET_MOCK", notice: net.notice }, feeMethod: cached.feeMethod,
    };
  };
}

/** Worker dependencies for the testnet demo. The executor exists only when explicitly enabled. */
export function testnetDependencies(store: OrderStore, env: Env = process.env): WorkerDependencies {
  const net = activeNetwork(env);
  if (net.name !== "testnet") throw new Error("TESTNET_DEPENDENCIES_REQUIRE_FAIRTICK_NETWORK_TESTNET");
  return {
    now: () => Math.floor(Date.now() / 1000), mode: "live", plan: requestPlan, prerequisites: measureLivePrerequisites,
    quote: (m, amount) => getMarketSnapshot({ symbol: net.symbol, inputUsdgBaseUnits: amount, maxFeedAgeSeconds: m.maxFeedAgeSeconds }),
    chain: testnetChainEvidence(store), marketLabel: net.marketLabel,
    ...(testnetExecutionRequested(env) ? { executor: createTestnetExecutor(env) } : {}),
  };
}
