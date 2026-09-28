# Public-testnet execution record

## Executed outcome — September 28, 2026

The authorized sequence was completed on Robinhood Chain testnet. Thirteen deployment/setup transactions and one price refresh succeeded. One replacement UI mandate was confirmed after the first mandate stopped before SERV on stale fixture evidence. The replacement made exactly one SERV request and broadcast exactly one purchase transaction: `0x6ff3ed3ac70b618b8ae7f244025a4a7177f2b4cea00b3ae5c8645c083be0ce16`.

The purchase is included and finalized. It spent 25 mUSDG and received 0.111043223588669236 mNVDA. Token settlement is verified. The transaction-specific Nitro receipt fields verify the actual fee as `152,274 gas x 10,000,000 wei = 1,522,740,000,000 wei`; `gasUsedForL1` is 15,244 gas within that total and is not added again. This independently matches the explorer value. All recorded mandate checks pass. Deployment/setup used 43,912,110,000,000 wei, the price refresh used 1,021,880,000,000 wei, and the purchase used 1,522,740,000,000 wei. The dedicated wallet's read-only balance check on September 28, 2026 found 1,953,543,270,000,000 wei and latest/pending nonce 15/15. mUSDG/mNVDA are valueless FairTick mock tokens, the 225 price is operator-set, and liquidity is operator controlled.

Wallet: `0x2a432DbE5Db0A6b2Aa0535e6592493679A26c9a0`. The dedicated local key matches this address; the key was never printed. The authorized pre-send check observed block `125409349` at `2026-09-27T23:17:29.260Z`, nonce latest/pending `0/0`, balance **0 ETH**, and gas price **10,000,000 wei**. The six predicted contract addresses have no code. The send gate stopped before signing because the wallet was unfunded; no SERV request was made.

| Category | Testnet ETH |
| --- | ---: |
| Six deployments, estimates with margin | 0.0001033575 |
| Seven setup calls, including approval and initial price (allowance) | 0.000021 |
| One optional price refresh (allowance) | 0.000003 |
| Single order gas maximum | 0.001 |
| Unspent ETH reserve | 0.0001 |
| Combined planning requirement | **0.0012273575** |

This is a planning envelope, not a guarantee that a faucet amount will suffice or that fees remain fixed. Setup and refresh allowances cannot be estimated against undeployed contracts. Re-estimate before approval and before each transaction; halt if the approved envelope is exceeded. The RPC gas estimate already bundles the L1 posting component, so it must not be added again.

## Proposed bounded sequence

1. The owner requests testnet ETH from the [official faucet](https://faucet.testnet.chain.robinhood.com/) for this wallet. Funding does not authorize a broadcast. Re-run the dry plan and compare the actual balance with the current requirement.
2. After explicit broadcast approval, deploy six mock contracts at nonces 0–5. Intended source SHA-256: `3dc06b4f10911ef908714cbb521fe76e0ea729d7a6d82f811d3f4300034cbaf3`. Predicted addresses and exact constructor data are retained in `data/testnet/robinhood_testnet-deploy-plan.json`.
3. Nonces 6–12 register the pool; mint 225,000 mUSDG and 1,000 mNVDA to controlled liquidity; sync; mint 100 mUSDG to the demo wallet; approve the demo router for **100 mUSDG**; and set the fixture price to 225. No official token or mainnet asset is approved. The allowance exceeds the one-order 25 mUSDG budget but is confined to this valueless mock router; it must be part of the approval.
4. Refresh the operator-set fixture once if needed. Start only the dedicated testnet worker with execution enabled for the approved run. Through the UI, confirm **one Buy now order: 25 mUSDG, maximum 230 mUSDG/mNVDA, one-hour expiry, no partial fills**. Set the form price to 230; do not assume its default matches this plan.
5. Record the actual SERV response, deterministic revalidation, one transaction identity, explorer URL, token transfers, included/finalized states, and the receipt. Do not create repeated orders to seek a favorable proposal. WAIT ends Buy now; ESCALATE requires review. Disable signing after this bounded run while reconciliation continues.

Deployment resumption persists encrypted signed bytes and hashes before sending. Completed receipts and runtime bytecode are checked. Nonce drift or an unknown response requires identity reconciliation; never remove the state file to manufacture a clean start.

## Unresolved verification

The public-testnet adapter verifies a total fee only from supported transaction-specific receipt fields and rejects an absent or invalid `gasUsedForL1` subset. A public fill can still establish token settlement while fee-dependent mandate checks remain unknown. Never mark the full receipt or public gate PASS from inclusion alone. Historical-state availability and finality delay remain endpoint observations.

The bounded public execution is complete. Repository publication was separately authorized for `https://github.com/TheWeirdDee/fairtick`. Public hosting, the X post, and form submission remain unauthorized.
