import React from "react";

export interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const normalized = (status || "").toUpperCase();

  let variant = "badge-neutral";
  let label = status.replace(/_/g, " ");

  switch (normalized) {
    case "ACTIVE":
      variant = "badge-success";
      label = "Active";
      break;
    case "COMPLETED":
    case "SETTLED":
      variant = "badge-success";
      label = "Completed";
      break;
    case "WAITING":
      variant = "badge-warning";
      label = "Waiting";
      break;
    case "SUBMITTING":
      variant = "badge-warning";
      label = "Submitting";
      break;
    case "PENDING":
    case "RESERVED":
      variant = "badge-warning";
      label = "Pending Reconciliation";
      break;
    case "NEEDS_ATTENTION":
      variant = "badge-danger";
      label = "Needs Attention";
      break;
    case "CANCELLED":
      variant = "badge-neutral";
      label = "Cancelled";
      break;
    case "EXPIRED":
      variant = "badge-neutral";
      label = "Expired";
      break;
    case "DRAFT":
      variant = "badge-neutral";
      label = "Draft";
      break;
    case "LIVE":
      variant = "badge-success";
      label = "Live Evidence";
      break;
    case "SYNTHETIC":
      variant = "badge-info";
      label = "Synthetic / Simulation";
      break;
    case "REPLAY":
      variant = "badge-info";
      label = "Replay Evidence";
      break;
    default:
      variant = "badge-neutral";
      label = normalized;
      break;
  }

  return (
    <span className={`badge ${variant} ${size === "sm" ? "btn-sm" : ""}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
