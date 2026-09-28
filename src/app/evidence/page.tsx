import Link from "next/link";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

export default function Evidence() {
  return <>
    <Header />
    <main className="container section narrow">
      <p className="eyebrow">RECORDED EVIDENCE</p>
      <h1>Execution evidence</h1>
      <div className="card">
        <h2>Public-testnet receipt recorded</h2>
        <p>One Robinhood Chain testnet transaction is included and finalized. It spent 25 mUSDG and received 0.111043223588669236 mNVDA. Both are FairTick mock tokens with no value; the price was an operator-set fixture and liquidity was controlled.</p>
        <p>Token settlement, the 1,522,740,000,000 wei actual fee, and every recorded mandate check passed. The Nitro receipt calculation uses gas used times effective gas price; its parent-chain gas field is a subset and is not added again.</p>
      </div>
      <h2>What has been recorded</h2>
      <p>The repository contains an authenticated SERV proposal on live public-testnet mock-market evidence, the finalized public receipt, and a separate local development-chain harness. Public testnet execution does not establish mainnet readiness.</p>
      <p><a href="/evidence/public-testnet-status.json">Download the sanitized public-testnet receipt</a>.</p>
      <p><a href="/evidence/serv-integration.json">Download the recorded SERV integration evidence</a> (real SERV response on synthetic market data).</p>
      <p><a href="/evidence/local-simulation.json">Download the local-chain simulation receipt</a> (not public-testnet settlement).</p>
      <p>FairTick mock tokens, operator-set prices and controlled liquidity remain labeled as such. Private order APIs require owner authentication.</p>
      <Link href="/docs/receipts">How to evaluate a receipt</Link>
    </main>
    <Footer />
  </>;
}
