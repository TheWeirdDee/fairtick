import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
// TESTNET DEMO: compiles the labeled mock contracts. Deterministic: pinned solc, fixed settings.
const solc = createRequire(import.meta.url)("solc");
const SOURCE = "contracts/testnet/FairTickDemo.sol";
const OUT = "contracts/testnet/artifacts/FairTickDemo.json";
const content = readFileSync(SOURCE, "utf8");
const settings = { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } } };
const output = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "FairTickDemo.sol": { content } }, settings })));
const errors = (output.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
for (const e of output.errors ?? []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);
const contracts: Record<string, { abi: unknown; bytecode: string; deployedBytecodeSha256: string }> = {};
for (const [name, c] of Object.entries(output.contracts["FairTickDemo.sol"] as Record<string, { abi: unknown; evm: { bytecode: { object: string }; deployedBytecode: { object: string } } }>)) {
  if (!c.evm.bytecode.object) continue; // interfaces
  contracts[name] = { abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, deployedBytecodeSha256: createHash("sha256").update(c.evm.deployedBytecode.object).digest("hex") };
}
mkdirSync("contracts/testnet/artifacts", { recursive: true });
const artifact = { notice: "FAIRTICK TESTNET DEMO MOCK CONTRACTS. Not USDG, not stock tokens, not Chainlink, not Uniswap.", compiler: solc.version(), settings, sourceSha256: createHash("sha256").update(content).digest("hex"), contracts };
writeFileSync(OUT, JSON.stringify(artifact, null, 1) + "\n");
console.log(JSON.stringify({ out: OUT, compiler: artifact.compiler, sourceSha256: artifact.sourceSha256, contracts: Object.fromEntries(Object.entries(contracts).map(([k, v]) => [k, (v.bytecode.length - 2) / 2])) }, null, 1));
