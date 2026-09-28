// TESTNET DEMO worker: the same worker, chain 46630 configuration only.
import { selectTestnet } from "./lib/testnet-env.js";
selectTestnet();
await import("./worker.js");
