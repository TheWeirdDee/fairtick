// TESTNET DEMO desk: `next start` with the testnet configuration (default port 3001). Run `npm run build` first.
import { spawn } from "node:child_process";
import { selectTestnet, option } from "./lib/testnet-env.js";

const net = selectTestnet();
const port = option("port") ?? "3001";
console.log(`FairTick desk on http://127.0.0.1:${port}: ${net.label}. ${net.notice}`);
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", port], { env: { ...process.env, FAIRTICK_NETWORK: "testnet" }, stdio: "inherit" });
child.on("exit", code => process.exit(code ?? 0));
