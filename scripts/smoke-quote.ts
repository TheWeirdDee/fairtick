import { getMarketSnapshot } from "../src/engine/quote.js";

const snap = await getMarketSnapshot({ symbol: "NVDA" });
console.log(JSON.stringify(snap, null, 2));
