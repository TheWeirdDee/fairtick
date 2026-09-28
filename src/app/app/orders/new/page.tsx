"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseUnits, isAddress } from "viem";
import { useAuth } from "../../../context/AuthContext";
import type { ExecutionMandate } from "../../../../engine/executionValidator";

export default function NewOrderPage() {
  const router = useRouter();
  const { api, health } = useAuth();
  const testnet = health?.network === "testnet";
  const sym = testnet ? (health?.symbol ?? "mNVDA") : "NVDA";
  const quoteSym = testnet ? "mUSDG" : "USDG";

  const [sender, setSender] = useState("");
  const [budget, setBudget] = useState("25");
  const [maxPerFill, setMaxPerFill] = useState("25");
  const [price, setPrice] = useState("250");
  const [hours, setHours] = useState("4");
  const [mode, setMode] = useState<"buy_now" | "work_my_order">("work_my_order");
  const [partial, setPartial] = useState(false);

  const [routeData, setRouteData] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<ExecutionMandate | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ route: Record<string, unknown>; sender: string | null }>("/api/orders")
      .then((res) => {
        if (res.route) setRouteData(res.route);
        if (res.sender && !sender) setSender(res.sender);
      })
      .catch(() => setError("Route unavailable. Check workspace configuration and retry."));
  }, [api, sender]);

  // Compute expiration preview with explicit timezone
  const expiryHours = Math.max(0.1, Number(hours) || 1);
  const expiryDate = new Date(Date.now() + expiryHours * 3600 * 1000);
  const expiryFormattedLocal = expiryDate.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const expiryFormattedNY = expiryDate.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " (America/New_York)";

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!sender || !isAddress(sender)) {
      setError("Please enter a valid 40-character hexadecimal public address (e.g. 0x...).");
      return;
    }

    try {
      if (![budget,maxPerFill,price].every(v=>/^\d+(\.\d{1,6})?$/.test(v))) throw new Error("Use positive token amounts with at most six decimal places.");
      if (!routeData) throw new Error("Route unavailable. Retry when the workspace service is ready.");
      if (!Number.isFinite(Number(hours)) || Number(hours)<0.1 || Number(hours)>168) throw new Error("Expiry must be between 0.1 and 168 hours.");
      const budgetUnits = parseUnits(budget, 6);
      const maxFillUnits = parseUnits(maxPerFill, 6);
      const priceUnits = parseUnits(price, 6);
      const minFillUnits = parseUnits("1", 6); // 1 USDG

      if (budgetUnits <= 0n || maxFillUnits <= 0n || priceUnits <= 0n) {
        throw new Error("All amounts must be positive decimal numbers.");
      }

      if (!partial && maxFillUnits < budgetUnits) throw new Error("Enable partial fills or set maximum per fill to the full budget.");
      if (budgetUnits < minFillUnits || maxFillUnits < minFillUnits) throw new Error("Minimum budget and fill are 1 quote token.");
      if (maxFillUnits > budgetUnits) {
        throw new Error("Maximum per fill cannot exceed total budget.");
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresAt = now + Math.floor(expiryHours * 3600);

      const mandate: ExecutionMandate = {
        orderId: crypto.randomUUID(),
        version: 1,
        owner: "operator",
        mode,
        side: "BUY",
        signer: sender as `0x${string}`,
        recipient: sender as `0x${string}`,
        route: (routeData || {}) as ExecutionMandate["route"],
        budget: budgetUnits.toString(),
        maxPerFill: maxFillUnits.toString(),
        minimumFill: minFillUnits.toString(),
        partialFillAllowed: partial,
        maxPriceMicroUsdg: priceUnits.toString(),
        maxPremiumBps: 15,
        usdgParityAccepted: true,
        minCheapBps: 0,
        // Testnet demo: the mock market has no exchange hours; the mandate explicitly allows closed US sessions.
        closedPolicy: health?.defaultClosedPolicy ?? "WAIT",
        maxSlippageBps: 30,
        maxPriceImpactBps: 100,
        maxFeedAgeSeconds: 900,
        maxQuoteAgeSeconds: 60,
        maxBlockAgeSeconds: 30,
        confirmedAt: now,
        expiresAt,
        maxFillCount: 10,
        maxAttempts: 20,
        maxGasWei: "1000000000000000",
        minimumGasReserveWei: "100000000000000",
      };

      setDraft(mandate);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Please enter valid decimal numbers.");
    }
  };

  const handleConfirm = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setError("");

    try {
      const res = await api<{ order: { id: string } }>("/api/orders", "POST", draft);
      router.push(`/app/orders/${encodeURIComponent(res.order.id)}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create order.");
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto" }}>
      <div style={{ marginBottom: "20px" }}>
        <Link href="/app" style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          ← Back to orders
        </Link>
        <h1 style={{ marginTop: "8px", fontSize: "1.75rem" }}>Create limit order</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          {testnet
            ? "TESTNET DEMO: if SERV proposes execution and deterministic code revalidates it, the worker signs one Robinhood testnet transaction with valueless mock tokens. Mainnet signing stays disabled."
            : "Configure limits and timing for your token purchase. Live broadcasting is disabled in this build; confirming starts market condition monitoring."}
        </p>
        {testnet && (
          <div role="note" className="notice notice-warning" style={{ marginTop: "12px", fontSize: "0.8125rem" }}>
            {health?.notice} Demo orders use closed-session policy ALLOW: the validator still records the real US session, but a mock market has no exchange hours.
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="notice notice-danger" style={{ marginBottom: "20px" }}>
          <div>{error}</div>
        </div>
      )}

      <div className="card" style={{ marginBottom: "24px" }}>
        <form onSubmit={handleReview}>
          {/* ASSET SELECTOR */}
          <div className="form-group">
            <label className="form-label">Trading Pair</label>
            <input
              type="text"
              className="form-input"
              value={testnet ? `${sym} / ${quoteSym} (${health?.networkLabel} · MOCK demo pool 0.05%, controlled liquidity)` : "NVDA / USDG (Robinhood Chain ID 4663 · Uniswap V3 0.05%)"}
              disabled
              style={{ backgroundColor: "var(--bg-subtle)", cursor: "not-allowed" }}
            />
            <span className="form-hint">
              {testnet ? "Mock demo route deployed by the operator. Not a Robinhood stock token and not market data." : "Currently verified route. Additional stock token pools are disabled in this environment."}
            </span>
          </div>

          {/* ORDER MODE */}
          <div className="form-group">
            <label htmlFor="order-mode" className="form-label">
              Order Mode
            </label>
            <select
              id="order-mode"
              className="form-select"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                setDraft(null);
              }}
            >
              <option value="work_my_order">Work my order — continuous market monitoring until expiry</option>
              <option value="buy_now">Buy now — single instantaneous observation check</option>
            </select>
            <span className="form-hint">
              Work my order periodically checks prices and liquidity; Buy now performs a single immediate check.
            </span>
          </div>

          {/* SENDER ADDRESS */}
          <div className="form-group">
            <label htmlFor="sender-address" className="form-label">
              Public Sender & Recipient Address
            </label>
            <input
              id="sender-address"
              type="text"
              className="form-input mono"
              placeholder="0x… (40-character public address)"
              value={sender}
              onChange={(e) => {
                setSender(e.target.value);
                setDraft(null);
              }}
              required
            />
            <span className="form-hint">
              Public address only. Never enter a private key. The operator workspace binds to this address.
            </span>
          </div>

          {/* BUDGET AND FILL SIZE */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div className="form-group">
              <label htmlFor="order-budget" className="form-label">
                Total Budget ({quoteSym})
              </label>
              <input
                id="order-budget"
                type="text"
                className="form-input num"
                placeholder="25.00"
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value);
                  setDraft(null);
                }}
                required
              />
              <span className="form-hint">Token amount; not an estimated dollar value.</span>
            </div>

            <div className="form-group">
              <label htmlFor="order-fill" className="form-label">
                Maximum Per Fill ({quoteSym})
              </label>
              <input
                id="order-fill"
                type="text"
                className="form-input num"
                placeholder="25.00"
                value={maxPerFill}
                onChange={(e) => {
                  setMaxPerFill(e.target.value);
                  setDraft(null);
                }}
                required
              />
              <span className="form-hint">Maximum slice size per execution.</span>
            </div>
          </div>

          {/* PRICE LIMIT AND EXPIRY */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div className="form-group">
              <label htmlFor="order-price" className="form-label">
                Maximum Price ({quoteSym} / {sym})
              </label>
              <input
                id="order-price"
                type="text"
                className="form-input num"
                placeholder="250.00"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setDraft(null);
                }}
                required
              />
              <span className="form-hint">Strict upper limit per {sym} token.</span>
            </div>

            <div className="form-group">
              <label htmlFor="order-expiry" className="form-label">
                Expiry in Hours
              </label>
              <input
                id="order-expiry"
                type="number"
                min="0.1"
                max="168"
                step="0.1"
                className="form-input num"
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setDraft(null);
                }}
                required
              />
              <span className="form-hint">
                Expires ~{expiryFormattedLocal} · {expiryFormattedNY}
              </span>
            </div>
          </div>

          {/* PARTIAL FILL PERMISSION */}
          <div className="form-group" style={{ marginTop: "8px" }}>
            <label className="form-checkbox-label">
              <input
                type="checkbox"
                checked={partial}
                onChange={(e) => {
                  setPartial(e.target.checked);
                  setDraft(null);
                }}
              />
              <span>Permit partial fills if liquidity is insufficient for the full budget</span>
            </label>
          </div>

          {/* FIXED SYSTEM LIMITS NOTICE */}
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "var(--bg-page)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-color)",
              fontSize: "0.8125rem",
              color: "var(--text-secondary)",
              marginBottom: "20px",
              lineHeight: 1.6,
            }}
          >
            <strong>Fixed default constraints:</strong> {testnet ? "Mock market allows closed sessions;" : "Regular trading session only;"} reference feed age ≤ 900s; quote age ≤ 60s; max reference premium ≤ 15 bps; max slippage ≤ 30 bps; max price impact ≤ 100 bps; minimum viable fill 1 {quoteSym}; max gas cap 0.001 ETH.
          </div>

          <button type="submit" className="btn btn-secondary" style={{ width: "100%" }}>
            Review order summary
          </button>
        </form>
      </div>

      {!health?.worker?.active && <p role="status">Confirmation is unavailable until a recent worker heartbeat is recorded.</p>}
      {/* CONFIRMATION REVIEW SUMMARY */}
      {draft && (
        <div className="card" style={{ border: "2px solid var(--primary)", marginBottom: "32px" }}>
          <div className="card-header">
            <div>
              <span className="badge badge-info" style={{ marginBottom: "4px" }}>
                Ready to confirm
              </span>
              <h3 style={{ margin: 0 }}>Review Mandate Summary</h3>
            </div>
          </div>

          <p style={{ marginBottom: "16px", fontSize: "0.9375rem" }}>
            {health?.executionEnabled ? "You are approving these limits for testnet mock-token execution by the worker." : "You are approving immutable instructions for monitoring and previews. Signing is currently disabled on the worker."}
          </p>

          <div className="stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            <div className="stat-box" style={{ padding: "12px" }}>
              <div className="stat-label">Total Budget</div>
              <div className="stat-value num" style={{ fontSize: "1.125rem" }}>{budget} {quoteSym}</div>
            </div>
            <div className="stat-box" style={{ padding: "12px" }}>
              <div className="stat-label">Max Price Limit</div>
              <div className="stat-value num" style={{ fontSize: "1.125rem" }}>{price} {quoteSym} / {sym}</div>
            </div>
            <div className="stat-box" style={{ padding: "12px" }}>
              <div className="stat-label">Execution Mode</div>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {mode === "work_my_order" ? "Work my order" : "Buy now"}
              </div>
            </div>
            <div className="stat-box" style={{ padding: "12px" }}>
              <div className="stat-label">Expiry Deadline</div>
              <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>
                {new Date(draft.expiresAt * 1000).toISOString()} (UTC)
              </div>
            </div>
          </div>

          <div style={{ fontSize: "0.875rem", color: "var(--text-secondary)", marginBottom: "20px" }}>
            <div><strong>Recipient:</strong> <span className="mono">{draft.recipient}</span></div>
            <div style={{ marginTop: "4px" }}>
              <strong>Partial fills:</strong> {draft.partialFillAllowed ? "Permitted" : "Not permitted (all-or-nothing)"}
            </div>
          </div>

          <details className="technical-details" style={{ marginBottom: "20px" }}>
            <summary>Technical mandate payload</summary>
            <pre>{JSON.stringify({ ...draft, route: testnet ? `Server allowlisted TESTNET MOCK ${sym}/${quoteSym} demo route` : "Server allowlisted NVDA/USDG V3 0.05% route" }, null, 2)}</pre>
          </details>

          <button
            onClick={handleConfirm}
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={busy || !health?.worker?.active}
          >
            {busy ? "Confirming mandate…" : health?.executionEnabled ? "Confirm testnet order" : "Start monitoring order"}
          </button>
        </div>
      )}
    </div>
  );
}
