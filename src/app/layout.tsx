import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./context/AuthContext";

export const metadata: Metadata = {
  title: "FairTick — Limit Orders for Tokenized Assets",
  description: "Create token purchase orders with budgets, price limits, and expiries. Owner-operated order monitoring and inspectable decisions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="page-wrapper">
          <AuthProvider>{children}</AuthProvider>
        </div>
      </body>
    </html>
  );
}
