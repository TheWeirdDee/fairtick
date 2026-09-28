# FairTick operations

## Runtime and process topology

Node 24, npm, Next.js web and `tsx scripts/worker.ts` run on one host. SQLite WAL requires a persistent local volume, not an ephemeral serverless filesystem, shared network mount or independently hosted web/worker pair. Both processes must have identical absolute DATABASE_PATH (mainnet) or TESTNET_DATABASE_PATH (testnet). The database binds to chain ID and local/public environment.

Install with `npm ci`; initialize access with `npm run setup-local`; apply `npm run db:migrate`; build with `npm run build`; start `npm start` and `npm run worker` separately. Migrations 001-003 apply idempotently under a transaction. Never rotate the existing OPERATOR_SECRET as part of routine setup.

## Configuration

| Variable | Use |
| --- | --- |
| OPERATOR_SECRET | Owner-selected or setup-generated code, at least 24 random characters. Private server configuration only. |
| APP_ORIGIN | Exact HTTPS public origin behind the reverse proxy; origin mismatch rejects browser mutations. |
| DATABASE_PATH | Absolute mainnet observation database path. |
| TESTNET_DATABASE_PATH | Separate absolute testnet database path. |
| FAIRTICK_NETWORK | mainnet (default) or testnet. Local testnet RPCs are labeled local development. |
| RH_RPC_URL | Mainnet read-only endpoint. |
| RH_SENDER_ADDRESS | Mainnet public wallet for read-only simulation. No mainnet key required. |
| FAIRTICK_TESTNET_RPC_URL | Dedicated testnet endpoint; defaults to documented public RPC. |
| FAIRTICK_TESTNET_REGISTRY | Mock registry written only after deployment verification. |
| RH_TESTNET_SENDER_ADDRESS | Dedicated public testnet wallet. |
| RH_TESTNET_PRIVATE_KEY | Worker/deployment only; distinct from mainnet; never public config. Also protects persisted signed payloads. |
| FAIRTICK_TESTNET_EXECUTE | Exactly true enables the testnet worker signer. Leave false until authorized. |
| SERV_API_KEY / SERV_MODEL | Worker planning provider and model; paid usage requires an approved budget. |

`.env.local` and `.env` are loaded if present; pre-existing process variables win. Container builds exclude these files. Supply separate `/etc/fairtick/web.env` and `/etc/fairtick/worker.env` files with owner-only permissions. Give the web process no signing key and no SERV key; the worker needs the key only for authorized testnet execution. Do not set RH_PRIVATE_KEY.

## Access and private data

`/access` exchanges the operator code for an eight-hour random session token in an HttpOnly, SameSite=Strict cookie, Secure when APP_ORIGIN is HTTPS. Only a hash bound to the owner secret is stored in SQLite. Sign-out deletes it. Expired sessions fail private API authorization. The old sessionStorage code is removed on page initialization. The owner code is not a SERV/Robinhood credential. There is no signup or password recovery.

Public health returns environment and readiness booleans plus persisted worker last-seen time, never wallet balances, orders, keys or RPC credentials. Public docs/tour/evidence do not expose the order APIs. Provider planning inputs include order instructions and public wallet information. Private SQLite includes mandates, snapshots, decisions and receipts; protect the database, WAL, backups and recovery state.

## Prepared production package (not deployed)

`Dockerfile` builds the production web and retains the worker runtime. `compose.yaml` runs web and worker with `restart: unless-stopped` on the same named local volume. Only web binds loopback port 3000; terminate HTTPS with the host reverse proxy and set APP_ORIGIN. On an approved host, provision the two environment files, build the image, run migrations with the same volume/environment, then start the two services. An example sequence after deployment authorization is `docker compose build`, `docker compose run --rm web npm run db:migrate`, `docker compose up -d`.

Docker packaging is prepared, but its build remains unverified because Docker is unavailable on this machine. A process supervisor or container runtime is required to restart a killed worker. An unhealthy Docker health check reports a problem but does not itself restart an otherwise running process. Monitor health and restart deliberately if the worker is stalled.

## Repository and hosting release steps (authorization required)

1. Run the final tests, typecheck, production build, browser verification, secret scan and `git diff --check`; review the working tree before creating any commit.
2. The public repository is `https://github.com/TheWeirdDee/fairtick`, configured as `origin`, and its default branch is `main`. For later approved releases, inspect the staged diff, create one reviewed commit, fetch `origin main`, reconcile any remote commits, and run `git push origin main` without force.
3. No hosting provider, project, domain, or deployment URL is configured. Provision the approved Linux host with a persistent local SSD volume, Docker Compose, DNS and an HTTPS reverse proxy. Keep web and worker on that single host.
4. Create owner-only `/etc/fairtick/web.env` and `/etc/fairtick/worker.env`. Give the signing key and SERV key only to the worker; do not configure a mainnet private key.
5. Check out the approved commit, run `docker compose build`, `docker compose run --rm web npm run db:migrate`, then `docker compose up -d`. These commands remain unverified until Docker is available and hosting is authorized.
6. Verify HTTPS origin enforcement, owner sign-in/sign-out, `/api/health`, `npm run worker:health`, persistent order recovery after both containers restart, public docs, and sanitized evidence downloads.
7. The repository URL is recorded in the README and submission material. Record a demo URL only after it is publicly reachable. Back up the SQLite volume before upgrades.

Web health: `/api/health` must be HTTP 200. Worker health: `npm run worker:health` exits 0 only for a heartbeat younger than 90 seconds. The worker updates heartbeat every 15 seconds, including while it awaits a provider. Heartbeat means process activity, not successful RPC reads or guaranteed progress. Confirm checks/decisions are advancing separately.

## Restart, recovery and cancellation

Stop gracefully with SIGTERM. Restarting retains mandates, reservations, nonce ownership and receipt measurements. Order leases expire after 120 seconds. A unique pending-wallet constraint prevents two orders owning simultaneous fills; chain/signer/nonce identities are durable and unique. Do not send unrelated transactions from the dedicated wallet during an execution run.

Reservation and signing-job parameters are stored atomically. On recovery, an unsigned job can sign only while its original evidence and deadline remain valid. Missing/legacy jobs or stale evidence retain the reservation for manual review. Do not edit accounting columns to unblock them. A crash after signing but before persistence cannot have broadcast under this code path; a retry can sign the same fixed transaction after the lease expires if evidence still permits it.

Signed bytes and identity are persisted in one SQLite transaction before broadcast. Payloads use AES-256-GCM with a domain-separated key derived from the dedicated testnet key. A restart decrypts and re-broadcasts only identical bytes with the same hash, while the original mandate remains active. Lost RPC replies, dropped transactions and nonce conflicts retain the reservation and never create a replacement purchase. Retain the same dedicated key for recovery; key rotation requires resolving pending jobs first.

Cancellation/expiry stop further sends observed by the worker. A send already in flight cannot be recalled. Identified transactions continue reconciliation after cancellation; unknown outcomes retain their reservation. No automatic nonce replacement is implemented. Included canonical transactions are Pending until the endpoint reports finality; a reorg invalidates their current inclusion. The cache is keyed by transaction and block hash and retries missing reference reads.

## Fee and evidence policy

Wallet balance deltas are not accepted as fee evidence: incoming ETH/internal transfers can contaminate them. Standard local EVM receipts use `gasUsed x effectiveGasPrice`. On the Nitro-based public testnet, the adapter accepts that transaction-specific total only when the receipt also exposes a valid `gasUsedForL1` subset. The subset is used to explain the parent/child split and is never added again. Missing or inconsistent fields keep the total fee UNKNOWN, withhold fee-dependent mandate compliance, and require attention without implying that a verified token settlement failed. Recorded finality delays and pruning are endpoint observations, not immutable chain promises.

The public testnet guard compares a finalized block hash with the documented public RPC and checks the canonical testnet gateway exists, in addition to chain ID. Local development is labeled separately. Deployment persists protected signed transactions before sending, resumes by transaction identity, verifies canonical receipts and compares deployed runtime bytecode with `eth_call` of the exact constructor payload (including immutables). Never remove state after nonce drift to pretend deployment starts fresh.

## Backups, logs and exports

Use SQLite's backup API for a consistent live backup, or stop both processes before copying database plus WAL. Restore to the same network/environment with the worker stopped, run migrations, inspect pending reservations, then restart and observe reconciliation. Retain the matching recovery key separately. Test restoration on an isolated copy before replacing production storage.

Worker stdout contains order IDs and stable outcome codes. Broadcast failures are reduced to safe codes rather than provider dumps of signed bytes. Restrict log retention and database access to the owner. Do not expose raw signed payloads, session hashes, private provider responses or local paths in public evidence. `scripts/export-evidence.ts` uses an allowlisted historical record export rather than dumping the database.

## Costs and supervision

Proposed hosting: one Linux host with at least 2 GB RAM, local persistent SSD and an HTTPS reverse proxy. A planning allowance of USD 10-25/month for compute plus USD 2-5/month for backups is an estimate, not a purchased plan or vendor quote. Existing owner hardware can incur no additional hosting invoice, but uptime and electricity are still the owner's responsibility. Public RPC access is rate-limited; production provider pricing remains unquoted. Do not buy infrastructure without approval.

SERV evidence records 10,022 ms latency and 1,712 tokens for one historical request, not a measured dollar cost. Billing cost and remaining credit must be read from the account. Faucet ETH has no value and does not cover provider/hosting costs.
