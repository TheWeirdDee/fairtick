# FairTick submission draft — not submitted

## Published rules checked September 27, 2026

The [official rules](https://www.openserv.ai/hackathon) set the deadline at September 28, 00:00 UTC (01:00 Africa/Lagos). They require a working, demoable SERV project; a public X post with the name, concept, images, relevant links, and `@openservai`; then the linked submission form. Judging considers creativity, user-readiness, and revenue potential. Eligibility requires data collection enabled in the [organization settings](https://console.openserv.ai/settings/organization).

**Account setting: BLOCKED / unverified.** A configured API key and successful response do not prove data collection is enabled. No console access was available in this session, and no account setting was changed.

**Track: Open Track proposed.** The rules describe Mainnet & MCP as agents acting on Robinhood Chain or operating funds through Robinhood MCP. They do not confirm testnet-only mock execution as sufficient. No organizer confirmation is claimed. Open Track explicitly covers SERV Reasoning projects and is the accurate provisional positioning.

## Form-ready project text

**Name:** FairTick

**Description:** FairTick is an owner-operated purchase-order workspace. Set a token budget, maximum price, and expiry; a persistent worker checks conditions, asks SERV for a bounded proposal, and records why the order proceeds, waits, or needs attention. Application code revalidates every proposal against the confirmed instructions.

**Architecture and SERV integration:** A Next.js web app and independent Node worker share SQLite WAL on one persistent host. Confirmed mandates are immutable. The worker checks freshness, wallet, and route constraints before sending a bounded evidence packet to SERV. Parsed proposals cannot change authorization. A dedicated testnet signer supports the labeled mock harness. Durable reservations, wallet nonce ownership, and protected signed-byte recovery precede submission. Receipts separate token settlement, compliance, fees, and finality.

**Current demonstration:** A browser-confirmed order on Robinhood Chain testnet used one real SERV proposal on live public-testnet mock-market evidence, deterministic revalidation, one transaction, and independent worker reconciliation through finality. The finalized transaction spent 25 mUSDG and received 0.111043223588669236 mNVDA. These are FairTick mock tokens with no value; the 225 reference was operator-set and liquidity was controlled. Token settlement, the 1,522,740,000,000 wei actual fee, and every recorded mandate check are verified from the finalized transaction receipt. Mainnet signing is disabled. This is not an official stock-token market or a demonstrated investment strategy.

**Creative distinction:** FairTick combines a purchase limit with evidence freshness, bounded SERV planning, durable monitoring, and separately inspectable verification findings. The worker can wait or escalate even when a quote is below the price limit. No unique-technology, superior-return, or guaranteed-execution claim is made.

**User readiness:** Public docs and a read-only tour explain the product and owner access. The owner can directly sign in, create/review/confirm, monitor, and cancel. Private APIs remain protected. The prepared package runs web and worker with persistent storage. Source is published; public hosting remains unapproved.

**Revenue hypothesis:** A small tokenized-asset treasury operator needing documented purchase limits and an audit trail is a prospective customer, not an acquired customer. A plausible model is a monthly hosted single-workspace service plus pass-through inference usage. A hypothetical USD 29/month base price needs customer and cost validation; no subscriptions, interviews, revenue, or savings have been demonstrated. Billing was not built.

**Measured economics:** The public run’s single SERV request took 11,216 ms and returned 1,805 tokens (1,707 prompt / 98 completion). No dollar charge was returned, so measured SERV cost remains unknown. The application verifies the purchase fee as `152,274 gas x 10,000,000 wei = 1,522,740,000,000 wei` from the transaction receipt. The receipt's 15,244 `gasUsedForL1` is a subset, so it is not added again; the result matches the explorer display. Compute and backup figures in `OPERATIONS.md` are estimates, not invoices.

**Repository URL:** https://github.com/TheWeirdDee/fairtick

**Live demo URL:** Not deployed. Owner action required.

**Evidence:** `public/evidence/public-testnet-status.json` contains the allowlisted finalized public receipt and explorer link. `public/evidence/serv-integration.json`, `public/evidence/local-simulation.json`, and `data/evidence/release/` retain the separate historical and local records.

## Feature and limitation table

| Feature | Implemented evidence | Limitation |
| --- | --- | --- |
| Direct access and public path | Cookie auth, docs, tour, evidence page | Single owner; no public signup |
| Persistent monitoring | Separate worker, heartbeat, SQLite | Single host; no public hosting |
| SERV proposals | One authenticated proposal on live public-testnet mock-market evidence | Mock inputs; no performance claim |
| Deterministic controls | Validator, revalidation, regression tests | No continuous inclusion-time oracle enforcement |
| Recovery | Reservations, wallet constraint, encrypted identical-byte replay | Stale unsigned or unknown replacement outcomes require review |
| Receipts | Finalized public token settlement, transaction-specific Nitro fee evidence, and individual mandate checks | A missing or inconsistent required receipt field returns fee-dependent checks to UNKNOWN |
| Public testnet | Deployed mock market, real SERV proposal, finalized transaction and sanitized receipt | Mock assets, operator-set price and controlled liquidity |
| Mainnet | Read-only observations | Purchases disabled; policy blockers remain |

## Ninety-second demo script

1. Open the landing page: “Set a budget, price, and expiry; the worker checks the same order in the background. This release is owner-operated.”
2. Open Docs and Product tour without signing in. Show Recorded evidence; identify the finalized public-testnet mock-market receipt and its separate settlement, finality, fee, and mandate findings.
3. Sign in with the private owner code off-camera. Never show the code, environment file, headers, or signing key.
4. Create one order. Review token units, absolute UTC expiry, fee cap, and partial-fill permission. Confirm once.
5. Show heartbeat, spent/reserved/available amounts, decision origin, and reason. Close the browser briefly and reopen the same order to demonstrate persistence.
6. Show the public explorer link and the real SERV proposal. Say “public Robinhood testnet, FairTick mock tokens, operator-set price, controlled liquidity.” Keep the separate local harness clearly labeled.
7. Show separate purchase finality, token settlement, fee, and individual mandate findings. Cancel a separate monitoring order and explain that a sent transaction cannot be undone.
8. End with the customer/pricing hypothesis and current public-testnet/mainnet limitations.

## Draft X announcement — do not post yet

Built FairTick for the @openservai hackathon: set a token budget, price limit, and expiry; a persistent worker checks conditions and SERV proposes a bounded action. Inspect why an order waits or proceeds.

Owner-operated UI, public docs, and labeled evidence. One finalized Robinhood Chain testnet transaction used a real SERV proposal with FairTick mock tokens, an operator-set price, and controlled liquidity. Token settlement, actual fee, and recorded mandate checks verified. No mainnet readiness claimed.

Attach actual UI screenshots. Include https://github.com/TheWeirdDee/fairtick. Add a demo link only after hosting is separately approved and verified. Use a thread if the final text exceeds the platform limit.

## Submission checklist

- Confirm organization data collection in the SERV account.
- Retain the finalized public receipt and describe the separate finality, settlement, fee, and individual mandate findings accurately.
- Retain the verified public repository URL; approve hosting separately and add its real URL only after deployment.
- Attach final screenshots and distinguish local receipt images from public evidence.
- Review and publish the X post only after separate approval, then complete the official form.

Nothing has been submitted, posted, deployed, committed, or pushed by this preparation.
