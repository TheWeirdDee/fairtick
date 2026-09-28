"use client";

import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAuth } from "../../../context/AuthContext";
import { StatusBadge } from "../../../components/StatusBadge";
import type { ExecutionMandate } from "../../../../engine/executionValidator";
import type { OrderRow } from "../../../../orders/store";
import type { VerifiedReceipt } from "../../../../engine/receipt";
import type { MarketSnapshot } from "../../../../engine/types";

interface OrderDetailView {
  order: OrderRow;
  mandate: ExecutionMandate;
  snapshot: MarketSnapshot | null;
  receipts: VerifiedReceipt[];
  decisions?: Array<{origin:string;created_at:number;body:Record<string,unknown>}>;
  latestDecision: {
    origin: string;
    createdAt?: number;
    kind?: string;
    outcome: string | null;
    action: string | null;
    synthetic: boolean;
    label: string | null;
    evidenceProvenance: string | null;
  } | null;
  intents?: Array<{ id: string; status: string; amount: string; minimum_output: string; reference_round: string }>;
  events?: Array<{ seq: number; order_id: string; type: string; body: string; created_at: number }>;
  aggregate: {
    spent: string;
    reserved: string;
    available: string;
    tokensReceived: string;
    gasWei: string;
    pending: boolean;
    settlementVerified: boolean;
    mandateComplianceVerified: boolean;
    evidenceModes: string[];
  };
}

// Chain 46630 orders use the TESTNET MOCK demo market (mock tokens, mock price, controlled liquidity).
const formatDollars = (baseUnits: string, quoteSym: string) => {
  try {
    const val = formatUnits(BigInt(baseUnits || "0"), 6);
    return `${val} ${quoteSym}`;
  } catch {
    return "Unavailable";
  }
};

const formatPrice = (microUsdg: string | null, sym: string) => {
  if (!microUsdg) return "None set";
  try {
    const val = formatUnits(BigInt(microUsdg), 6);
    return `${val} / ${sym}`;
  } catch {
    return microUsdg;
  }
};

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const orderId = resolvedParams.id;
  const { api, health } = useAuth();

  const [view, setView] = useState<OrderDetailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  useEffect(()=>{if(!showCancelModal)return;const previous=document.activeElement as HTMLElement;const dialog=document.querySelector('[role="dialog"]')!;const buttons=Array.from(dialog.querySelectorAll('button'));buttons[0]?.focus();const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setShowCancelModal(false);if(e.key==='Tab'){const index=buttons.indexOf(document.activeElement as HTMLButtonElement);e.preventDefault();buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();}};document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);previous?.focus();};},[showCancelModal]);

  const fetchDetails = useCallback(async () => {
    try {
      const data = await api<OrderDetailView>(`/api/orders/${encodeURIComponent(orderId)}`);
      setView(data);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load order details.");
    } finally {
      setLoading(false);
    }
  }, [api, orderId]);

  useEffect(() => {
    fetchDetails();
    const interval = setInterval(fetchDetails, 4000);
    return () => clearInterval(interval);
  }, [fetchDetails]);

  const handleCancel = async () => {
    setCancelling(true);
    setError("");
    try {
      await api(`/api/orders/${encodeURIComponent(orderId)}`, "DELETE");
      setShowCancelModal(false);
      await fetchDetails();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel order.");
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !view) {
    return (
      <div className="card" style={{ padding: "48px", textAlign: "center" }}>
        <p>Loading order details…</p>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="card" style={{ padding: "48px", textAlign: "center" }}>
        <h2 style={{ color: "var(--danger-text)" }}>Unable to load order</h2>
        <p style={{ marginTop: "8px", marginBottom: "20px" }}>{error}</p>
        <Link href="/app" className="btn btn-secondary">
          ← Back to orders
        </Link>
      </div>
    );
  }

  if (!view) return null;

  const { order, mandate, snapshot, receipts, latestDecision, aggregate } = view;
  const isTerminal = ["CANCELLED", "COMPLETED", "EXPIRED"].includes(order.status);
  const tokensDecimals = mandate.route?.tokenDecimals ?? 18;
  const mock = mandate.route?.chainId === 46630;
  const sym = mock ? "mNVDA" : "NVDA", quoteSym = mock ? "mUSDG" : "USDG";
  const dollars = (v: string) => formatDollars(v, quoteSym);
  const priceDollars = (v: string | null) => formatPrice(v, sym).replace(" / ", ` ${quoteSym} / `);

  let tokensFormatted = "0.0000";
  try {
    tokensFormatted = formatUnits(BigInt(aggregate.tokensReceived || "0"), tokensDecimals);
  } catch {
    tokensFormatted = aggregate.tokensReceived;
  }

  let gasEth = "0.0000";
  try {
    gasEth = formatUnits(BigInt(aggregate.gasWei || "0"), 18);
  } catch {
    gasEth = aggregate.gasWei;
  }

  return (
    <div>
      {/* NAVIGATION BREADCRUMB */}
      <div style={{ marginBottom: "16px" }}>
        <Link href="/app" style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          ← Back to orders overview
        </Link>
      </div>

      {error && (
        <div role="alert" className="notice notice-danger" style={{ marginBottom: "20px" }}>
          <div>{error}</div>
        </div>
      )}

      {/* TOP HEADER */}
      <div
        className="card"
        style={{
          marginBottom: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Order Details</h1>
            <StatusBadge status={order.status} />
          </div>
          <p className="mono" style={{ color: "var(--text-secondary)", fontSize: "0.875rem", margin: 0 }}>
            ID: {order.id}
          </p>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8125rem", marginTop: "4px", margin: 0 }}>
            Created {new Date(order.created_at * 1000).toLocaleString()} · Last checked {(latestDecision?.createdAt ? new Date(latestDecision.createdAt * 1000).toISOString() : "Not checked")}
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            onClick={() => {
              setLoading(true);
              fetchDetails();
            }}
            className="btn btn-secondary btn-sm"
          >
            Refresh
          </button>

          {!isTerminal && (
            <button
              onClick={() => setShowCancelModal(true)}
              className="btn btn-danger btn-sm"
              disabled={cancelling}
            >
              Cancel order
            </button>
          )}
        </div>
      </div>

      {/* CURRENT STATUS & NEXT ACTION */}
      <div
        className="card"
        style={{
          marginBottom: "24px",
          backgroundColor: order.status === "NEEDS_ATTENTION" ? "var(--danger-bg)" : "var(--bg-surface)",
          border: order.status === "NEEDS_ATTENTION" ? "1px solid var(--danger-border)" : "1px solid var(--border-color)",
        }}
      >
        <h3 style={{ marginBottom: "8px", fontSize: "1rem" }}>Current Condition & Status</h3>
        <p style={{ fontSize: "1rem", color: "var(--text-primary)", fontWeight: 500, margin: 0 }}>
          {order.reason || "Awaiting first market evaluation."}
        </p>

        <div style={{ marginTop: "12px", display: "flex", gap: "24px", flexWrap: "wrap", fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          <div>
            <strong>Next scheduled check:</strong>{" "}
            {order.next_check ? new Date(order.next_check * 1000).toISOString() : isTerminal ? "None (Order ended)" : "None scheduled"}
          </div>
          <div>
            <strong>Checks performed:</strong> {order.checks}
          </div>
          <div>
            <strong>Fills settled:</strong> {order.fills}
          </div>
        </div>

        {aggregate.pending && (
          <div className="notice notice-warning" style={{ marginTop: "16px", marginBottom: 0 }}>
            <div>
              <strong>Pending funds reserved:</strong> A pending execution is undergoing on-chain reconciliation. Funds remain reserved until the transaction status is confirmed.
            </div>
          </div>
        )}
      </div>

      <section className="card" style={{marginBottom:24}}><h2>Worker and wallet readiness</h2><p>Worker: {health?.worker?.active ? 'Recent heartbeat' : 'No recent heartbeat'}. Last seen: {health?.worker?.lastSeen ? new Date(health.worker.lastSeen*1000).toISOString() : 'Unavailable'}.</p><p>Configured wallet: {health?.senderPresent ? 'Present; balance and allowance checked per attempt' : 'Missing'}. Read the current decision for insufficient funds, allowance and gas-reserve findings.</p><p>Network: {health?.networkLabel ?? 'Unavailable'}. Asset: {sym}; price source: {mock ? 'operator-set fixture' : 'recorded oracle observation'}.</p></section>
      {/* ACCOUNTING & BALANCES */}
      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px", marginBottom: "24px" }}>
        <div className="stat-box">
          <div className="stat-label">Approved Budget</div>
          <div className="stat-value num">{dollars(order.budget)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Spent</div>
          <div className="stat-value num" style={{ color: "var(--text-primary)" }}>{dollars(aggregate.spent)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Reserved (In Flight)</div>
          <div className="stat-value num" style={{ color: aggregate.reserved !== "0" ? "var(--warning-text)" : "var(--text-secondary)" }}>
            {dollars(aggregate.reserved)}
          </div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Remaining Available</div>
          <div className="stat-value num" style={{ color: "var(--primary)" }}>{dollars(aggregate.available)}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Tokens Received</div>
          <div className="stat-value num">{tokensFormatted} {sym}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">{receipts.length > 0 && receipts.every(r=>r.gasCostVerified) ? "Verified actual fee" : "Recorded gas component"}</div>
          <div className="stat-value num">{gasEth} ETH</div>
        </div>
      </div>

      {/* USER LIMITS & MANDATE CONSTRAINTS */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <h3 style={{ marginBottom: "16px" }}>Confirmed Mandate Limits</h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", fontSize: "0.875rem" }}>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Trading Pair</div>
            <div style={{ fontWeight: 600 }}>{mandate.route.chainId === 46630 ? `${sym} / ${quoteSym} (TESTNET MOCK demo pool, chain 46630)` : "NVDA / USDG (Uniswap V3)"}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Order Mode</div>
            <div style={{ fontWeight: 600 }}>{mandate.mode === "work_my_order" ? "Work my order" : "Buy now"}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Maximum Price Limit</div>
            <div className="num" style={{ fontWeight: 600 }}>{priceDollars(mandate.maxPriceMicroUsdg)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Maximum Per Fill</div>
            <div className="num" style={{ fontWeight: 600 }}>{dollars(mandate.maxPerFill)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Expiry Deadline</div>
            <div style={{ fontWeight: 600 }}>{new Date(mandate.expiresAt * 1000).toISOString()}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)" }}>Partial Fills Allowed</div>
            <div style={{ fontWeight: 600 }}>{mandate.partialFillAllowed ? "Yes" : "No"}</div>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: "var(--text-secondary)" }}>Recipient & Signer Address</div>
            <div className="mono" style={{ fontWeight: 600, wordBreak: "break-all" }}>{mandate.recipient}</div>
          </div>
        </div>
      </div>

      {/* LATEST MARKET SNAPSHOT & DECISION */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card-header">
          <div>
            <h3 style={{ margin: 0 }}>Latest Market Condition & Decision</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
              Evaluation recorded by the FairTick worker.
            </p>
          </div>
          {latestDecision && (
            <span className="badge badge-info">
              {latestDecision.origin === "serv" ? "SERV Proposal" : "Application Rules"}
            </span>
          )}
        </div>

        {snapshot ? (
          <div>
            <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              <div className="stat-box" style={{ padding: "12px" }}>
                <div className="stat-label">{mock ? "Operator-set fixture price" : "Reference oracle feed"}</div>
                <div className="stat-value" style={{ fontSize: "1.125rem" }}>
                  {snapshot.feedPriceUsd ? `$${snapshot.feedPriceUsd.toFixed(2)} USD` : "Unavailable"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Age: {snapshot.feedAgeSeconds ?? "unknown"}s (max {mandate.maxFeedAgeSeconds}s)
                </div>
              </div>

              <div className="stat-box" style={{ padding: "12px" }}>
                <div className="stat-label">Executable Quote Price</div>
                <div className="stat-value" style={{ fontSize: "1.125rem" }}>
                  {snapshot.executableQuote
                    ? `${snapshot.executableQuote.effectivePriceUsdgPerToken.toFixed(6)} ${quoteSym} / ${sym}`
                    : "Unavailable"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Impact: {snapshot.executableQuote?.priceImpactBps ? `${snapshot.executableQuote.priceImpactBps} bps` : "Unavailable"}
                </div>
              </div>

              <div className="stat-box" style={{ padding: "12px" }}>
                <div className="stat-label">Session Status</div>
                <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)", marginTop: "4px" }}>
                  {snapshot.session?.name ?? "UNKNOWN"}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Trading open: {snapshot.session?.cashMarketOpen ? "Yes" : "No"}
                </div>
              </div>

              <div className="stat-box" style={{ padding: "12px" }}>
                <div className="stat-label">Data Provenance</div>
                <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginTop: "4px" }}>
                  <StatusBadge status={snapshot.provenance || "UNKNOWN"} size="sm" />
                </div>
              </div>
            </div>

            {latestDecision?.label && (
              <div style={{ padding: "10px 14px", backgroundColor: "var(--bg-page)", borderRadius: "var(--radius-sm)", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                <strong>Decision label:</strong> {latestDecision.label}
              </div>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            No snapshot recorded yet. Make sure the background worker is running to evaluate order conditions.
          </p>
        )}
      </div>

      {/* RECEIPT / RECONCILIATION */}
      <div className="card" style={{ marginBottom: "24px" }}>
        <div className="card-header">
          <div>
            <h3 style={{ margin: 0 }}>Execution Receipts & Settlement</h3>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
              Settlement and mandate compliance verification evidence.
            </p>
          </div>
        </div>

        {receipts.length === 0 ? (
          <div style={{ padding: "16px", backgroundColor: "var(--bg-page)", borderRadius: "var(--radius-md)", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            No fill receipt recorded. A pending transaction, if present, still requires reconciliation. No settled purchase is claimed.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {receipts.map((r, idx) => (
              <div
                key={r.intentId || idx}
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-md)",
                  padding: "16px",
                  backgroundColor: "var(--bg-surface)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      Intent {r.intentId?.slice(0, 8)}…
                    </span>
                    <span style={{ marginLeft: "8px", fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                      Outcome: <strong>{r.outcome}</strong> ({r.mode.toUpperCase()}{r.environment ? ` · ${r.environment.network}${r.environment.marketData === "TESTNET_MOCK" ? " · TESTNET MOCK MARKET, mock tokens" : ""}` : ""})
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap:"wrap" }}><span className="badge">{r.finalized ? "Finalized" : r.included ? "Included; finality pending" : "Inclusion unverified"}</span><span className="badge">{r.gasCostVerified ? "Fee verified" : "Total fee unknown"}</span>
                    <span className={`badge ${r.settlementVerified ? "badge-success" : "badge-warning"}`}>
                      {r.settlementVerified ? "Settlement Verified" : "Unverified"}
                    </span>
                    <span className={`badge ${r.mandateComplianceVerified ? "badge-success" : "badge-warning"}`}>
                      {r.mandateComplianceVerified ? "Mandate Compliant" : "Compliance not verified"}
                    </span>
                  </div>
                </div>

                {r.finalized && r.settlementVerified && <div style={{padding:"10px 12px",marginBottom:10,borderRadius:"var(--radius-md)",background:"var(--success-bg, #ecfdf3)",color:"var(--success, #166534)",fontSize:"0.8125rem"}}><strong>Purchase finalized.</strong> Token settlement is verified. No retry or duplicate purchase is needed.</div>}
                {!r.gasCostVerified && <div style={{padding:"10px 12px",marginBottom:10,borderRadius:"var(--radius-md)",background:"var(--warning-bg, #fffbeb)",color:"var(--warning, #92400e)",fontSize:"0.8125rem"}}><strong>Needs attention: fee verification is pending.</strong> The purchase succeeded and token settlement is verified, but the receipt does not yet provide enough supported evidence to verify the total fee and fee-dependent mandate checks. Do not create another purchase.</div>}

                <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "10px" }}>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Amount In</div>
                    <div className="num" style={{ fontWeight: 600 }}>{dollars(r.amountIn)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>Amount Out</div>
                    <div className="num" style={{ fontWeight: 600 }}>{formatUnits(BigInt(r.amountOut || "0"), tokensDecimals)} {sym}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>{r.gasCostVerified ? "Verified fee" : "Receipt gas component; total unknown"}</div>
                    <div className="num" style={{ fontWeight: 600 }}>{formatUnits(BigInt(r.gasWei || "0"), 18)} ETH</div>
                  </div>
                </div>

                {r.complianceChecks && r.complianceChecks.length > 0 && <div style={{marginBottom:10}}>
                  <div style={{fontWeight:600,fontSize:"0.8125rem",marginBottom:6}}>Individual receipt checks</div>
                  <div style={{display:"grid",gap:6}}>{r.complianceChecks.map(check=><div key={check.key} style={{display:"grid",gridTemplateColumns:"minmax(150px, 1fr) auto",gap:"8px 12px",padding:"8px 10px",border:"1px solid var(--border-color)",borderRadius:"var(--radius-sm)",fontSize:"0.75rem"}}>
                    <div><strong>{check.label}</strong><div style={{color:"var(--text-secondary)",overflowWrap:"anywhere"}}>Actual: {check.actual}</div><div style={{color:"var(--text-secondary)",overflowWrap:"anywhere"}}>Required: {check.required}</div></div>
                    <span className={`badge ${check.status === "PASS" ? "badge-success" : "badge-warning"}`}>{check.status}</span>
                  </div>)}</div>
                </div>}

                {r.transactionHash && (
                  <div style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                    <strong>Transaction:</strong> {health?.explorerUrl && r.mode === "live" ? <a className="mono" href={`${health.explorerUrl}/tx/${r.transactionHash}`} target="_blank" rel="noreferrer">{r.transactionHash}</a> : <span className="mono">{r.transactionHash}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <section className="card" style={{marginBottom:24}}><h2>Decision history</h2>{view.decisions?.length ? view.decisions.map((d,i)=><details key={i}><summary>{new Date(d.created_at*1000).toISOString()} / {d.origin==='serv'?'SERV':'Application rules'} / {String(d.body.outcome??d.body.action??'Check')}</summary><pre>{JSON.stringify(d.body,null,2)}</pre></details>):<p>No decisions recorded.</p>}</section>
      {/* EXPANDABLE TECHNICAL DETAILS */}
      <details className="technical-details">
        <summary>Technical Details & Raw Storage Evidence</summary>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <h4 style={{ color: "var(--text-secondary)", marginBottom: "6px" }}>Approved Mandate Schema</h4>
            <pre>{JSON.stringify(mandate, null, 2)}</pre>
          </div>
          {snapshot && (
            <div>
              <h4 style={{ color: "var(--text-secondary)", marginBottom: "6px" }}>Latest Raw Market Snapshot</h4>
              <pre>{JSON.stringify(snapshot, null, 2)}</pre>
            </div>
          )}
          {view.events && view.events.length > 0 && (
            <div>
              <h4 style={{ color: "var(--text-secondary)", marginBottom: "6px" }}>Append-Only Order Event Log</h4>
              <pre>{JSON.stringify(view.events, null, 2)}</pre>
            </div>
          )}
        </div>
      </details>

      {/* CANCELLATION CONFIRMATION MODAL */}
      {showCancelModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(23, 33, 47, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            className="card" role="dialog" aria-modal="true" aria-labelledby="cancel-title"
            style={{
              maxWidth: "480px",
              width: "100%",
              padding: "24px",
              boxShadow: "var(--shadow-md)",
            }}
          >
            <h2 id="cancel-title" style={{ fontSize: "1.25rem", marginBottom: "8px" }}>Cancel Order</h2>
            <p style={{ fontSize: "0.9375rem", marginBottom: "20px" }}>
              Are you sure you want to cancel this order? This will stop future market evaluations. Any already-broadcast pending transaction will still undergo reconciliation before funds are released.
            </p>

            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowCancelModal(false)}
                className="btn btn-secondary"
                disabled={cancelling}
              >
                Keep Order Active
              </button>
              <button
                onClick={handleCancel}
                className="btn btn-danger"
                disabled={cancelling}
              >
                {cancelling ? "Cancelling…" : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
