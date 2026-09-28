// Read-only feed-suitability evidence, pinned to one block. For the NVDA and SPY
// Standard proxies (directory `proxyAddress`) and their SVR proxies (directory
// `secondaryProxyAddress`): aggregator identity and latest round, the last 40
// rounds of history, the trigger each update is consistent with (documented
// 0.5% deviation / 86,400s heartbeat), and how often a 60-second worker check in
// our REGULAR session would have seen a reference age <= 900s. Trigger labels
// and coverage are inferences from on-chain history, not documented facts.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseAbi, type Address } from "viem";
import { getPublicClient, CORE_ADDRESSES } from "../src/lib/chain.js";
import { sessionAt } from "../src/engine/session.js";

const MAX_AGE = 900, SAMPLE = 60, ROUNDS = 40;
const feeds = {
  NVDA: { standard: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", svr: "0xCF169363636D73dbBf77733629CB38919d14232d" },
  SPY: { standard: "0x319724394D3A0e3669269846abE664Cd621f9f6A", svr: "0xa68CA83408bE3f78d1c58a82081c619e9d21486d" },
} as const;
const proxyAbi = parseAbi([
  "function aggregator() view returns (address)",
  "function phaseId() view returns (uint16)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
const aggAbi = parseAbi(["function typeAndVersion() view returns (string)"]);
const c = getPublicClient();
const block = await c.getBlock();
const at = { blockNumber: block.number, multicallAddress: CORE_ADDRESSES.multicall3 as Address, allowFailure: true } as const;
const str = (v: unknown) => (typeof v === "bigint" ? v.toString() : v);
const report: Record<string, unknown> = { observedAt: new Date().toISOString(), block: block.number.toString(), blockTimestamp: Number(block.timestamp),
  documented: { deviationPercent: 0.5, heartbeatSeconds: 86400, source: "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json (rendered by docs.chain.link as Deviation/Heartbeat)" } };

for (const [symbol, f] of Object.entries(feeds)) {
  const proxies: Record<string, unknown> = {};
  for (const [label, address] of Object.entries(f) as [string, Address][]) {
    const [agg, phase, latest] = await c.multicall({ ...at, contracts: [
      { address, abi: proxyAbi, functionName: "aggregator" }, { address, abi: proxyAbi, functionName: "phaseId" }, { address, abi: proxyAbi, functionName: "latestRoundData" },
    ] });
    const aggregator = agg.status === "success" ? (agg.result as Address) : null;
    const [tv] = aggregator ? await c.multicall({ ...at, contracts: [{ address: aggregator, abi: aggAbi, functionName: "typeAndVersion" }] }) : [null];
    proxies[label] = { address, aggregator, typeAndVersion: tv?.status === "success" ? tv.result : null, phaseId: phase.status === "success" ? phase.result : null,
      latestRoundData: latest.status === "success" ? (latest.result as readonly unknown[]).map(str) : null };
  }
  const latest = await c.readContract({ address: f.standard, abi: proxyAbi, functionName: "latestRoundData", blockNumber: block.number });
  const phase = latest[0] >> 64n, top = latest[0] & ((1n << 64n) - 1n);
  const ids: bigint[] = []; for (let r = top; r >= 1n && ids.length < ROUNDS; r--) ids.push((phase << 64n) | r);
  const rows = await c.multicall({ ...at, contracts: ids.map(id => ({ address: f.standard as Address, abi: proxyAbi, functionName: "getRoundData" as const, args: [id] as const })) });
  const hist = rows.flatMap((r, i) => r.status === "success" ? [{ aggRound: Number(ids[i]! & ((1n << 64n) - 1n)), answer: (r.result as readonly bigint[])[1]!, updatedAt: Number((r.result as readonly bigint[])[3]!) }] : []).reverse();
  const steps = hist.slice(1).map((h, i) => {
    const prev = hist[i]!, gap = h.updatedAt - prev.updatedAt;
    const moveBps = Number(((h.answer > prev.answer ? h.answer - prev.answer : prev.answer - h.answer) * 1_000_000n) / prev.answer) / 100;
    return { aggRound: h.aggRound, updatedAtUtc: new Date(h.updatedAt * 1000).toISOString(), session: sessionAt(new Date(h.updatedAt * 1000)).name, gapSeconds: gap, moveBps,
      consistentWith: moveBps >= 50 ? "deviation >= 0.5%" : Math.abs(gap - 86400) <= 600 ? "24h heartbeat" : "neither (e.g. first update after a market closure)" };
  });
  // Coverage: sample every 60s; count REGULAR-session samples whose reference age is <= 900s.
  let samples = 0, fresh = 0, k = 0; const perDay: Record<string, { checks: number; fresh: number }> = {};
  for (let t = hist[0]!.updatedAt; t <= Number(block.timestamp); t += SAMPLE) {
    while (k + 1 < hist.length && hist[k + 1]!.updatedAt <= t) k++;
    const s = sessionAt(new Date(t * 1000));
    if (s.name !== "REGULAR") continue;
    const day = s.asOf.slice(0, 10), ok = t - hist[k]!.updatedAt <= MAX_AGE;
    samples++; if (ok) fresh++;
    (perDay[day] ??= { checks: 0, fresh: 0 }).checks++; if (ok) perDay[day]!.fresh++;
  }
  report[symbol] = { proxies, history: { rounds: hist.length, firstUtc: new Date(hist[0]!.updatedAt * 1000).toISOString(), lastUtc: new Date(hist.at(-1)!.updatedAt * 1000).toISOString(),
    consistentWithCounts: steps.reduce<Record<string, number>>((a, s) => ({ ...a, [s.consistentWith]: (a[s.consistentWith] ?? 0) + 1 }), {}),
    medianGapSeconds: steps.map(s => s.gapSeconds).sort((a, b) => a - b)[Math.floor(steps.length / 2)] ?? null, steps },
    regularSessionCoverage: { method: "60s samples in REGULAR sessions (src/engine/session.ts); fresh = age <= 900s", checks: samples, fresh, share: samples ? Number((fresh / samples).toFixed(4)) : null, perDay } };
}
mkdirSync("data/evidence", { recursive: true });
const file = `data/evidence/feed-history-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
const brief = (sym: string) => { const r = report[sym] as Record<string, any>; return { proxies: r.proxies, consistentWith: r.history.consistentWithCounts, medianGapSeconds: r.history.medianGapSeconds, regularSessionFreshShare: r.regularSessionCoverage.share, perDay: r.regularSessionCoverage.perDay }; };
console.log(JSON.stringify({ file, observedAt: report.observedAt, block: report.block, NVDA: brief("NVDA"), SPY: brief("SPY") }, null, 2));
