// Creates (once) a SEPARATE testnet-only wallet in .env.local. Prints only the public address.
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { normalizeKey } from "../src/orders/testnet.js";

const file = ".env.local";
const text = existsSync(file) ? readFileSync(file, "utf8") : "";
const vars = parseEnv(text) as Record<string, string | undefined>;
const mainnetKey = normalizeKey(vars.RH_PRIVATE_KEY ?? process.env.RH_PRIVATE_KEY);
const mainnetSender = (vars.RH_SENDER_ADDRESS ?? process.env.RH_SENDER_ADDRESS)?.toLowerCase();
const mainnetAddresses = new Set([mainnetSender, mainnetKey ? privateKeyToAccount(mainnetKey).address.toLowerCase() : undefined].filter(Boolean));

let key = normalizeKey(vars.RH_TESTNET_PRIVATE_KEY);
let created = false;
if (vars.RH_TESTNET_PRIVATE_KEY && !key) throw new Error("RH_TESTNET_PRIVATE_KEY in .env.local is malformed; fix or remove that line (not printed).");
if (!key) {
  do { key = generatePrivateKey(); } while (key === mainnetKey || mainnetAddresses.has(privateKeyToAccount(key).address.toLowerCase()));
  created = true;
}
if (key === mainnetKey) throw new Error("Refusing: RH_TESTNET_PRIVATE_KEY equals the mainnet key. Remove it and rerun to generate a separate testnet key.");
const address = privateKeyToAccount(key).address;
if (mainnetAddresses.has(address.toLowerCase())) throw new Error("Refusing: the testnet key controls the mainnet sender.");
if (vars.RH_TESTNET_SENDER_ADDRESS && vars.RH_TESTNET_SENDER_ADDRESS.toLowerCase() !== address.toLowerCase()) {
  throw new Error("RH_TESTNET_SENDER_ADDRESS in .env.local does not match RH_TESTNET_PRIVATE_KEY; fix or remove it.");
}

const lines: string[] = [];
if (created) {
  lines.push("", "# FairTick TESTNET demo wallet: Robinhood Chain testnet (46630) only. Separate from mainnet.",
    "# Holds faucet test ETH and valueless mock tokens. Never send real assets to it.", `RH_TESTNET_PRIVATE_KEY=${key}`);
}
if (!vars.RH_TESTNET_SENDER_ADDRESS) lines.push(`RH_TESTNET_SENDER_ADDRESS=${address}`);
if (lines.length) {
  const needsNewline = text.length > 0 && !text.endsWith("\n");
  if (existsSync(file)) appendFileSync(file, (needsNewline ? "\n" : "") + lines.join("\n") + "\n");
  else writeFileSync(file, lines.join("\n") + "\n", { mode: 0o600 });
}
console.log(JSON.stringify({
  testnetWallet: address, created, storedIn: ".env.local (gitignored; key not printed)", separateFromMainnet: true,
  faucet: { url: "https://faucet.testnet.chain.robinhood.com", action: `Request testnet ETH for ${address} in a browser (the faucet page requires JavaScript).` },
}, null, 1));
