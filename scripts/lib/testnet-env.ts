import "../../src/lib/env.js";
import { activeNetwork, TESTNET_CHAIN_ID } from "../../src/lib/network.js";
/** Every testnet script starts here: it can only ever select chain 46630. */
export function selectTestnet() {
  const requested = process.env.FAIRTICK_NETWORK?.trim().toLowerCase();
  if (requested && requested !== "testnet") throw new Error(`Refusing: FAIRTICK_NETWORK=${requested}. Testnet scripts only run against chain ${TESTNET_CHAIN_ID}.`);
  process.env.FAIRTICK_NETWORK = "testnet";
  const net = activeNetwork();
  if (net.chainId !== TESTNET_CHAIN_ID) throw new Error("TESTNET_SELECTION_FAILED");
  return net;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);
export const option = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
