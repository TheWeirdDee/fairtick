import React from "react";

export interface EnvironmentBadgeProps {
  network?: string;
  dataProvenance?: string;
  modeLabel?: string;
}

export function EnvironmentBadge({
  network = "Robinhood Chain (ID 4663)",
  dataProvenance = "Live RPC / Feeds",
  modeLabel = "Observation Mode",
}: EnvironmentBadgeProps) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "0.8125rem",
        padding: "6px 12px",
        borderRadius: "var(--radius-sm)",
        backgroundColor: "var(--bg-subtle)",
        border: "1px solid var(--border-color)",
        color: "var(--text-secondary)",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
        <span
          style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: "var(--primary)",
            display: "inline-block",
          }}
        />
        <span>
          <strong>Network:</strong> {network}
        </span>
      </div>
      <span style={{ color: "var(--border-strong)" }}>|</span>
      <div>
        <strong>Market Data:</strong> {dataProvenance}
      </div>
      <span style={{ color: "var(--border-strong)" }}>|</span>
      <span className="badge badge-warning" style={{ padding: "2px 6px", fontSize: "0.75rem" }}>
        {modeLabel}
      </span>
    </div>
  );
}
