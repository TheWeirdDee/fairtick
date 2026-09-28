"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../context/AuthContext";

export interface HeaderProps {
  isAppShell?: boolean;
}

export function Header({ isAppShell = false }: HeaderProps) {
  const pathname = usePathname();
  const { isAuthenticated, logout } = useAuth();

  return (
    <header className="site-header">
      <div className="container">
        <div className="site-header-inner">
          <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
            <Link href={isAppShell ? "/app" : "/"} className="brand-link" aria-label="FairTick Home">
              <span className="brand-mark">F</span>
              <span>FairTick</span>
            </Link>

            {isAppShell && (
              <nav className="nav-links" aria-label="App Navigation" style={{ marginLeft: "12px" }}>
                <Link
                  href="/app"
                  className={`nav-link ${pathname === "/app" ? "active" : ""}`}
                >
                  Orders
                </Link>
                <Link
                  href="/app/orders/new"
                  className={`nav-link ${pathname === "/app/orders/new" ? "active" : ""}`}
                >
                  Create order
                </Link>
              </nav>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {!isAppShell ? (
              <>
                <nav className="nav-links" aria-label="Public Navigation">
                  <Link href="/tour" className="nav-link">Product</Link>
                  <Link href="/#how-it-works" className="nav-link">How it works</Link>
                  <Link href="/docs" className="nav-link">Docs</Link>
                </nav>
                <Link href="/app" className="btn btn-primary btn-sm">
                  Open workspace
                </Link>
              </>
            ) : (
              <>
                <Link href="/" className="nav-link" style={{ fontSize: "0.875rem" }}>
                  Public site
                </Link>
                {isAuthenticated && (
                  <button
                    onClick={() => logout().catch(() => alert('Sign-out unavailable. Please retry.'))}
                    className="btn btn-secondary btn-sm"
                    title="Sign out and clear secret from memory"
                  >
                    Sign out
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
