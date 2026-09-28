"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import type { OrderRow } from "../../orders/store";

const dollars = (baseUnits: string) => {
  try {
    const val = formatUnits(BigInt(baseUnits || "0"), 6);
    return formatUnits(BigInt(baseUnits), 6);
  } catch {
    return "Unavailable";
  }
};

export default function OrdersPage() {
  const { api, health } = useAuth();
  const pair=health?.network === "testnet" ? "mNVDA / mUSDG" : "NVDA / USDG";
  const quoteSym=health?.network === "testnet" ? "mUSDG" : "USDG";
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");

  const fetchOrders = useCallback(async () => {
    try {
      const data = await api<{ orders: OrderRow[]; route: unknown; sender: string | null }>("/api/orders");
      setOrders(data.orders || []);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const activeStatuses = new Set(["ACTIVE", "WAITING", "SUBMITTING", "PENDING", "NEEDS_ATTENTION", "DRAFT"]);
  const completedStatuses = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

  const filteredOrders = orders.filter((o) => {
    if (filter === "active") return activeStatuses.has(o.status);
    if (filter === "completed") return completedStatuses.has(o.status);
    return true;
  });

  return (
    <div>
      {/* HEADER BAR */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: "1.75rem" }}>Your orders</h1>
          <p style={{ marginTop: "4px", fontSize: "0.875rem" }}>
            Review your active mandates, price bounds, and execution history.
          </p>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={() => {
              setLoading(true);
              fetchOrders();
            }}
            className="btn btn-secondary btn-sm"
            disabled={loading}
          >
            Refresh
          </button>
          <Link href="/app/orders/new" className="btn btn-primary">
            Create order
          </Link>
        </div>
      </div>

      {error && (
        <div role="alert" className="notice notice-danger" style={{ marginBottom: "20px" }}>
          <div>{error}</div>
        </div>
      )}

      {/* FILTER TABS */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          borderBottom: "1px solid var(--border-color)",
          marginBottom: "20px",
        }}
      >
        <button
          onClick={() => setFilter("all")}
          className={`btn btn-sm ${filter === "all" ? "btn-primary" : "btn-secondary"}`}
          style={{ borderRadius: "var(--radius-sm) var(--radius-sm) 0 0", borderBottom: "none" }}
        >
          All ({orders.length})
        </button>
        <button
          onClick={() => setFilter("active")}
          className={`btn btn-sm ${filter === "active" ? "btn-primary" : "btn-secondary"}`}
          style={{ borderRadius: "var(--radius-sm) var(--radius-sm) 0 0", borderBottom: "none" }}
        >
          Active ({orders.filter((o) => activeStatuses.has(o.status)).length})
        </button>
        <button
          onClick={() => setFilter("completed")}
          className={`btn btn-sm ${filter === "completed" ? "btn-primary" : "btn-secondary"}`}
          style={{ borderRadius: "var(--radius-sm) var(--radius-sm) 0 0", borderBottom: "none" }}
        >
          Completed ({orders.filter((o) => completedStatuses.has(o.status)).length})
        </button>
      </div>

      {/* ORDERS LIST / TABLE */}
      {loading && orders.length === 0 ? (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <p>Loading your orders…</p>
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="card" style={{ padding: "48px", textAlign: "center" }}>
          <div style={{ maxWidth: "440px", margin: "0 auto" }}>
            <h3 style={{ marginBottom: "8px" }}>
              {filter === "all" ? "No orders found" : `No ${filter} orders`}
            </h3>
            <p style={{ marginBottom: "20px", fontSize: "0.875rem" }}>
              {filter === "all"
                ? "You haven't created any limit orders yet. Set your price limits and budget to request order monitoring."
                : `There are currently no orders in the ${filter} state.`}
            </p>
            <Link href="/app/orders/new" className="btn btn-primary">
              Create your first order
            </Link>
          </div>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Asset</th>
                <th>Budget</th>
                <th>Spent</th>
                <th>Status</th>
                <th>Latest Observation</th>
                <th>Last Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link
                      href={`/app/orders/${encodeURIComponent(o.id)}`}
                      className="mono"
                      style={{ fontWeight: 600 }}
                    >
                      {o.id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td>
                    <strong>{pair}</strong>
                  </td>
                  <td className="num">{dollars(o.budget)} {quoteSym}</td>
                  <td className="num">{dollars(o.settled)} {quoteSym}</td>
                  <td>
                    <StatusBadge status={o.status} size="sm" />
                  </td>
                  <td style={{ maxWidth: "260px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={o.reason}>
                    <span style={{ fontSize: "0.8125rem", color: "var(--text-secondary)" }}>
                      {o.reason || "Awaiting first check"}
                    </span>
                  </td>
                  <td style={{ fontSize: "0.8125rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {new Date(o.updated_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td>
                    <Link
                      href={`/app/orders/${encodeURIComponent(o.id)}`}
                      className="btn btn-secondary btn-sm"
                    >
                      View details
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
