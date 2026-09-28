import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  keccak256, encodeDeployData, encodeFunctionData, getContractAddress, http, parseAbi,
  type Abi, type Address, type Hash, type Hex,
} from "viem";
import { protectTransaction,recoverTransaction } from "../orders/protectedTransaction.js";
import type { PrivateKeyAccount } from "viem/accounts";
import { activeChain, getPublicClient } from "../lib/chain.js";
import { activeNetwork, TESTNET_CHAIN_ID } from "../lib/network.js";
import type { Registry } from "../lib/registry.js";

/**
 * TESTNET DEMO MARKET. Deploys and seeds clearly labeled mock contracts on chain
 * 46630 (Robinhood testnet, or a loopback devnet using that chain id). Every
 * transaction is planned from the deployer nonce, so contract addresses are
 * known before anything is sent. Nothing here ever runs against mainnet.
 */
export const ARTIFACT_PATH = "contracts/testnet/artifacts/FairTickDemo.json";
export const DEMO = {
  quote: { name: "FairTick Demo Mock USD (TESTNET, no value)", symbol: "mUSDG", decimals: 6 },
  token: { name: "FairTick Demo Mock NVDA (TESTNET, no value)", symbol: "mNVDA", decimals: 18 },
  feedDescription: "MOCK mNVDA / USD (operator-set TESTNET demo price; not Chainlink, not market data)",
  fee: 500,
  poolQuote: 225_000n * 10n ** 6n, // controlled liquidity: 225,000 mUSDG ...
  poolToken: 1_000n * 10n ** 18n, // ... against 1,000 mNVDA => 225 mUSDG per mNVDA
  walletQuote: 100n * 10n ** 6n, // mock spending balance for the demo wallet
  referencePrice: 225n, // mock reference, 8 decimals on chain
} as const;

export interface Artifact { compiler: string; sourceSha256: string; contracts: Record<string, { abi: Abi; bytecode: Hex }> }
export function loadArtifact(): Artifact {
  if (!existsSync(ARTIFACT_PATH)) throw new Error("ARTIFACT_MISSING: run npm run testnet:compile");
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as Artifact;
}

export interface PlannedTx {
  step: number; label: string; nonce: number;
  kind: "deploy" | "call"; contract: string; to: Address | null; data: Hex;
  predictedAddress: Address | null; fn: string; args: string[];
}
export interface DemoAddresses { quote: Address; token: Address; feed: Address; router: Address; pool: Address; quoter: Address }

const DEMO_TOKEN_ABI = parseAbi(["function mint(address,uint256)", "function approve(address,uint256) returns (bool)"]);
const ROUTER_ADMIN_ABI = parseAbi(["function setPool(address)"]);
const POOL_ADMIN_ABI = parseAbi(["function sync()"]);
export const FEED_ADMIN_ABI = parseAbi(["function updateAnswer(int256)"]);

export function predictAddresses(deployer: Address, startNonce: number): DemoAddresses {
  const at = (i: number) => getContractAddress({ from: deployer, nonce: BigInt(startNonce + i) });
  return { quote: at(0), token: at(1), feed: at(2), router: at(3), pool: at(4), quoter: at(5) };
}

/** Thirteen transactions from one testnet wallet. `referencePrice` is whole mock-USD. */
export function deploymentPlan(deployer: Address, startNonce: number, artifact = loadArtifact(), referencePrice: bigint = DEMO.referencePrice): PlannedTx[] {
  const a = predictAddresses(deployer, startNonce), c = artifact.contracts;
  const deploy = (contract: string, args: unknown[]) => encodeDeployData({ abi: c[contract]!.abi, bytecode: c[contract]!.bytecode, args });
  const rows: Omit<PlannedTx, "step" | "nonce">[] = [
    { label: "Deploy mock quote token mUSDG (6 decimals)", kind: "deploy", contract: "DemoToken", to: null, predictedAddress: a.quote, fn: "constructor", args: [DEMO.quote.name, DEMO.quote.symbol, "6"], data: deploy("DemoToken", [DEMO.quote.name, DEMO.quote.symbol, DEMO.quote.decimals]) },
    { label: "Deploy mock stock token mNVDA (18 decimals)", kind: "deploy", contract: "DemoToken", to: null, predictedAddress: a.token, fn: "constructor", args: [DEMO.token.name, DEMO.token.symbol, "18"], data: deploy("DemoToken", [DEMO.token.name, DEMO.token.symbol, DEMO.token.decimals]) },
    { label: "Deploy mock price feed (operator-set)", kind: "deploy", contract: "DemoAggregator", to: null, predictedAddress: a.feed, fn: "constructor", args: [DEMO.feedDescription], data: deploy("DemoAggregator", [DEMO.feedDescription]) },
    { label: "Deploy demo router (SwapRouter02-shaped calls)", kind: "deploy", contract: "DemoRouter", to: null, predictedAddress: a.router, fn: "constructor", args: [], data: deploy("DemoRouter", []) },
    { label: "Deploy controlled-liquidity pool mUSDG/mNVDA 0.05%", kind: "deploy", contract: "DemoPool", to: null, predictedAddress: a.pool, fn: "constructor", args: [a.quote, a.token, String(DEMO.fee), a.router], data: deploy("DemoPool", [a.quote, a.token, DEMO.fee, a.router]) },
    { label: "Deploy demo quoter (QuoterV2-shaped)", kind: "deploy", contract: "DemoQuoter", to: null, predictedAddress: a.quoter, fn: "constructor", args: [a.router], data: deploy("DemoQuoter", [a.router]) },
    { label: "Register pool with router", kind: "call", contract: "DemoRouter", to: a.router, predictedAddress: null, fn: "setPool", args: [a.pool], data: encodeFunctionData({ abi: ROUTER_ADMIN_ABI, functionName: "setPool", args: [a.pool] }) },
    { label: "Seed pool: mint 225,000 mUSDG (mock)", kind: "call", contract: "DemoToken", to: a.quote, predictedAddress: null, fn: "mint", args: [a.pool, DEMO.poolQuote.toString()], data: encodeFunctionData({ abi: DEMO_TOKEN_ABI, functionName: "mint", args: [a.pool, DEMO.poolQuote] }) },
    { label: "Seed pool: mint 1,000 mNVDA (mock)", kind: "call", contract: "DemoToken", to: a.token, predictedAddress: null, fn: "mint", args: [a.pool, DEMO.poolToken.toString()], data: encodeFunctionData({ abi: DEMO_TOKEN_ABI, functionName: "mint", args: [a.pool, DEMO.poolToken] }) },
    { label: "Sync pool reserves", kind: "call", contract: "DemoPool", to: a.pool, predictedAddress: null, fn: "sync", args: [], data: encodeFunctionData({ abi: POOL_ADMIN_ABI, functionName: "sync" }) },
    { label: "Mint 100 mUSDG (mock) to the testnet wallet", kind: "call", contract: "DemoToken", to: a.quote, predictedAddress: null, fn: "mint", args: [deployer, DEMO.walletQuote.toString()], data: encodeFunctionData({ abi: DEMO_TOKEN_ABI, functionName: "mint", args: [deployer, DEMO.walletQuote] }) },
    { label: "Approve demo router for 100 mUSDG (mock token only)", kind: "call", contract: "DemoToken", to: a.quote, predictedAddress: null, fn: "approve", args: [a.router, DEMO.walletQuote.toString()], data: encodeFunctionData({ abi: DEMO_TOKEN_ABI, functionName: "approve", args: [a.router, DEMO.walletQuote] }) },
    { label: `Set mock reference price ${referencePrice} (8 decimals)`, kind: "call", contract: "DemoAggregator", to: a.feed, predictedAddress: null, fn: "updateAnswer", args: [(referencePrice * 10n ** 8n).toString()], data: encodeFunctionData({ abi: FEED_ADMIN_ABI, functionName: "updateAnswer", args: [referencePrice * 10n ** 8n] }) },
  ];
  return rows.map((r, step) => ({ ...r, step, nonce: startNonce + step }));
}

export function registryFor(deployer: Address, a: DemoAddresses, block: bigint, at: Date, local: boolean): Registry {
  const [token0, token1] = BigInt(a.quote) < BigInt(a.token) ? [{ address: a.quote, symbol: DEMO.quote.symbol }, { address: a.token, symbol: DEMO.token.symbol }] : [{ address: a.token, symbol: DEMO.token.symbol }, { address: a.quote, symbol: DEMO.quote.symbol }];
  const source = local ? "deployed by FairTick scripts on a LOCAL DEVNET (chain id 46630)" : "deployed by FairTick scripts/testnet-deploy.ts on Robinhood Chain testnet 46630";
  return {
    chainId: TESTNET_CHAIN_ID, network: local ? "local-devnet-46630" : "robinhood-testnet", verifiedAt: at.toISOString(), verifiedAtBlock: block.toString(),
    demo: { mock: true, notice: activeNetwork().notice ?? "TESTNET DEMO MOCK MARKET", referencePriceUsd: DEMO.referencePrice.toString(), deployer, contracts: { ...a } },
    core: {
      usdg: { address: a.quote, decimals: 6, symbol: DEMO.quote.symbol, source: `MOCK quote token, ${source}` },
      router: { address: a.router, source: `MOCK demo router, ${source}` },
      quoter: { address: a.quoter, source: `MOCK demo quoter, ${source}` },
    },
    symbols: {
      [DEMO.token.symbol]: {
        status: "verified",
        token: { address: a.token, decimals: 18, symbol: DEMO.token.symbol, name: DEMO.token.name, source: `MOCK token, ${source}` },
        uiMultiplier: { valueRaw: "1000000000000000000", valueDecimal: 1, source: "mock constant", note: "Mock asset: no multiplier changes" },
        feed: { proxyAddress: a.feed, aggregatorAddress: a.feed, decimals: 8, description: DEMO.feedDescription, heartbeatSeconds: 86_400, source: `MOCK operator-set feed, ${source}` },
        pool: { protocol: "fairtickDemoPool", address: a.pool, feeTier: DEMO.fee, token0, token1, quoteToken: "USDG", selectionRationale: "Only demo pool; controlled liquidity seeded by the operator", verifiedAtBlock: block.toString() },
        corporateAction: { pending: false, source: "Not applicable: mock asset" },
        tradingHaltAtVerification: false,
      },
    },
  };
}

const READ_ABI = parseAbi([
  "function DEMO_NOTICE() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)",
  "function token0() view returns (address)", "function token1() view returns (address)", "function router() view returns (address)",
  "function reserve0() view returns (uint256)", "function reserve1() view returns (uint256)", "function poolFor(address,address,uint24) view returns (address)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function description() view returns (string)",
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
]);

/** Read-only check of the deployed demo market's actual state (not just code presence). */
export async function inspectDemoMarket(a: DemoAddresses, wallet: Address) {
  const c = getPublicClient();
  const r = <T>(address: Address, functionName: string, args: unknown[] = []) =>
    c.readContract({ address, abi: READ_ABI, functionName: functionName as never, args: args as never }).then(v => v as T, () => null);
  const codes = Object.fromEntries(await Promise.all(Object.entries(a).map(async ([k, v]) => [k, ((await c.getBytecode({ address: v }).catch(() => undefined))?.length ?? 2) / 2 - 1] as const)));
  const [quoteSymbol, tokenSymbol, poolRouter, reserve0, reserve1, routedPool, round, feedDescription, walletQuote, walletAllowance, walletToken, quoteNotice] = await Promise.all([
    r<string>(a.quote, "symbol"), r<string>(a.token, "symbol"), r<Address>(a.pool, "router"), r<bigint>(a.pool, "reserve0"), r<bigint>(a.pool, "reserve1"),
    r<Address>(a.router, "poolFor", [a.quote, a.token, DEMO.fee]), r<readonly bigint[]>(a.feed, "latestRoundData"), r<string>(a.feed, "description"),
    r<bigint>(a.quote, "balanceOf", [wallet]), r<bigint>(a.quote, "allowance", [wallet, a.router]), r<bigint>(a.token, "balanceOf", [wallet]), r<string>(a.quote, "DEMO_NOTICE"),
  ]);
  const block = await c.getBlock();
  const feedAge = round ? Number(block.timestamp) - Number(round[3]) : null;
  return {
    codeBytes: codes, quoteSymbol, tokenSymbol, quoteNotice, feedDescription,
    poolRouterMatches: poolRouter?.toLowerCase() === a.router.toLowerCase(), routerPoolMatches: routedPool?.toLowerCase() === a.pool.toLowerCase(),
    reserves: reserve0 === null || reserve1 === null ? null : [reserve0.toString(), reserve1.toString()],
    feed: round ? { roundId: round[0]!.toString(), answer: round[1]!.toString(), updatedAt: Number(round[3]), ageSeconds: feedAge } : null,
    wallet: { mUSDG: walletQuote?.toString() ?? null, allowanceToRouter: walletAllowance?.toString() ?? null, mNVDA: walletToken?.toString() ?? null },
    block: block.number.toString(), blockTimestamp: Number(block.timestamp),
  };
}

export interface DeployState { chainId: number; environment: string; deployer: Address; sourceSha256: string; startNonce: number; referencePrice: string; pending?: {step:number;hash:Hash;protectedRaw:string}; completed: { step: number; hash: Hash; block: string; gasUsed: string; effectiveGasPrice: string; contractAddress: Address | null }[] }
export const statePathFor = (registryPath: string) => resolve(dirname(resolve(registryPath)), `${activeNetwork().environment.toLowerCase()}.deploy-state.json`);
export function readState(path: string): DeployState | null { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as DeployState : null; }
export function writeJson(path: string, value: unknown) { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(path, JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 1) + "\n"); }

/** Sends planned transactions one at a time, resuming from recorded state. Caller has already
 * verified chain id 46630, the dedicated key and an explicit --broadcast request. */
export async function broadcastPlan(account: PrivateKeyAccount, plan: PlannedTx[], state: DeployState, statePath: string, log: (line: string) => void) {
  const chain = activeChain(), client = getPublicClient();

  for (const tx of plan) {
    const completed=state.completed.find(c=>c.step===tx.step);
    if(completed){
      const receipt=await client.getTransactionReceipt({hash:completed.hash});
      const canonical=await client.getBlock({blockNumber:receipt.blockNumber});
      if(receipt.status!=="success"||canonical.hash!==receipt.blockHash)throw new Error("DEPLOYMENT_RESUME_RECEIPT_INVALID");
      if(tx.predictedAddress){const [expected,actual]=await Promise.all([client.call({account:account.address,data:tx.data}),client.getBytecode({address:tx.predictedAddress})]);if(!expected.data||expected.data.toLowerCase()!==actual?.toLowerCase())throw new Error("DEPLOYMENT_RESUME_BYTECODE_MISMATCH");}
      continue;
    }
    if (await client.getChainId() !== TESTNET_CHAIN_ID) throw new Error("CHAIN_CHANGED_DURING_DEPLOYMENT");
    const nonce = await client.getTransactionCount({ address: account.address, blockTag: "pending" });
    if (!state.pending && nonce !== tx.nonce) throw new Error(`NONCE_DRIFT: planned ${tx.nonce}, observed ${nonce}; preserve deployment state and reconcile before continuing`);
    if(state.pending && state.pending.step!==tx.step)throw new Error("DEPLOYMENT_PENDING_STEP_CONFLICT");
    if(!state.pending){
      const gasPrice = await client.getGasPrice();
      const gas = (await client.estimateGas({ account: account.address, to: tx.to ?? undefined, data: tx.data, value: 0n }) * 13n) / 10n;
      const raw=await account.signTransaction({chainId:46630,type:'eip1559',to:tx.to??undefined,data:tx.data,value:0n,nonce:tx.nonce,gas,maxFeePerGas:gasPrice*2n,maxPriorityFeePerGas:0n});
      state.pending={step:tx.step,hash:keccak256(raw),protectedRaw:protectTransaction(raw)};
      writeJson(statePath,state);
    }
    const hash=state.pending.hash;
    const known=await client.getTransactionReceipt({hash}).catch(()=>null);
    if(!known){const raw=recoverTransaction(state.pending.protectedRaw);if(keccak256(raw)!==hash)throw new Error('DEPLOYMENT_IDENTITY_MISMATCH');try{await client.sendRawTransaction({serializedTransaction:raw});}catch{if(!await client.getTransaction({hash}).catch(()=>null))throw new Error('DEPLOYMENT_BROADCAST_UNKNOWN_RETAIN_STATE');}}
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`STEP_REVERTED: ${tx.step} ${tx.label} ${hash}`);
    if (tx.predictedAddress && receipt.contractAddress?.toLowerCase() !== tx.predictedAddress.toLowerCase()) throw new Error(`ADDRESS_MISMATCH at step ${tx.step}`);
    if(tx.predictedAddress){
      // Simulating the exact creation payload returns runtime bytecode with the
      // constructor's immutable values populated. Nothing is signed by eth_call.
      const [expected,actual]=await Promise.all([client.call({account:account.address,data:tx.data}),client.getBytecode({address:tx.predictedAddress})]);
      if(!expected.data||expected.data.toLowerCase()!==actual?.toLowerCase())throw new Error(`RUNTIME_BYTECODE_MISMATCH:${tx.step}`);
    }
    state.completed.push({ step: tx.step, hash, block: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), contractAddress: receipt.contractAddress ?? null });
    delete state.pending;
    writeJson(statePath, state);
    log(`  [${tx.step}] ${tx.label}: ${hash} (block ${receipt.blockNumber}, gas ${receipt.gasUsed})`);
  }
}
