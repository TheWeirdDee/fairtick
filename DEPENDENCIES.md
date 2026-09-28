# Public-testnet dependency observations

Observation: 2026-09-27T17:30:05.651Z. Read-only probe: `npx tsx scripts/testnet-release-probe.ts`; retained JSON: `data/evidence/testnet-release-probe.json`.

| Token / origin | Current address | Reference source | Router / pool / liquidity | Evidence |
| --- | --- | --- | --- | --- |
| WETH / official testnet deployment | 0x7943e237c7F95DA44E0301572D358911207852Fa | No price-feed integration verified | No suitable purchase route verified; liquidity unmeasured | Official protocol-contract table; 2,202 bytes of code, on-chain WETH / 18 decimals and explorer metadata |
| TSLA / candidate test asset, official faucet identity unconfirmed | 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E | No verified testnet reference found in inspected sources | No suitable verified router/pool found; liquidity unmeasured | 283-byte proxy code; on-chain TSLA / 18 decimals; explorer Tesla metadata |
| PLTR / candidate test asset, official faucet identity unconfirmed | 0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0 | No verified testnet reference found in inspected sources | No suitable verified router/pool found; liquidity unmeasured | 283-byte proxy code; on-chain PLTR / 18 decimals; explorer metadata |
| mUSDG / FairTick mock | Predicted 0x31D04794C7eEe6Ca9f1b072DBb7d01E19Fa17e79; no deployed code | Operator-set fixture, not market data | Planned controlled pool; undeployed, no current liquidity | Nonce-0 deployment plan and zero-bytecode probe |
| mNVDA / FairTick mock | Predicted 0x8Da66d02E99E3c6E7a7684Ecc29D8278bBA17E05; no deployed code | Planned feed 0xa992D490b09d8511BfB70F65BDE1b543F242058A | Planned router 0x32eB0c9c0A74e00fd5798B172C962dc7DFA6f2Da and pool 0xDF08Cf5486F4b9f8ABA77b3c823e816cE60a5B46; no code | Local harness only; public deployment not authorized |

Official sources: [network endpoints](https://docs.robinhood.com/chain/connecting/), [testnet protocol contracts](https://docs.robinhood.com/chain/protocol-contracts/), [testnet availability](https://robinhood.com/us/en/support/articles/robinhood-chain-testnet/), [Arbitrum launch factsheet](https://forum.arbitrum.foundation/t/arbitrumdao-factsheet-robinhood-chain-testnet-launches-on-arbitrum/30551).

Explorer evidence: [WETH](https://explorer.testnet.chain.robinhood.com/token/0x7943e237c7F95DA44E0301572D358911207852Fa), [TSLA](https://explorer.testnet.chain.robinhood.com/token/0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E), [PLTR](https://explorer.testnet.chain.robinhood.com/token/0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0). Token names and proxy source verification alone do not prove issuer identity or a liquid market.

The launch factsheet describes simulated stock tokens. Current official support still links the faucet, but automated retrieval of that faucet returned a security checkpoint. No faucet transaction was attempted. The currently accessible token-contract page primarily links mainnet and cannot authenticate these testnet candidates by itself. No verified deployment found in these sources is not a claim that none exists. No candidate has been silently promoted into the release registry.

Integrating an official test token still needs authenticated identity, a compatible route, measured liquidity, a suitable price source and a receipt adapter. That combination is not established, so the release retains the labeled mock harness. No independent price feed was added and no freshness/corporate-action policy was loosened.
