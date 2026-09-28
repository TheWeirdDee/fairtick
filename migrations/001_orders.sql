CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mandates(id TEXT PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, hash TEXT NOT NULL, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY REFERENCES mandates(order_id), owner TEXT NOT NULL, signer TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('ACTIVE','WAITING','SUBMITTING','PENDING','NEEDS_ATTENTION','COMPLETED','CANCELLED','EXPIRED')),
 budget TEXT NOT NULL, settled TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0', received TEXT NOT NULL DEFAULT '0',
 gas_spent TEXT NOT NULL DEFAULT '0', gas_reserved TEXT NOT NULL DEFAULT '0', fills INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
 checks INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL,
 next_check INTEGER, reason TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 cancelled_at INTEGER, lease_token TEXT, lease_until INTEGER,
 CHECK(budget_valid(budget, settled, reserved)=1)
);
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), snapshot_id TEXT REFERENCES snapshots(id), origin TEXT NOT NULL CHECK(origin IN ('code','serv')), body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS fill_intents(
 id TEXT PRIMARY KEY, job_key TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL REFERENCES orders(id), signer TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('RESERVED','PENDING','SETTLED','REVERTED','REVIEW')),
 amount TEXT NOT NULL, gas_bound TEXT NOT NULL, minimum_output TEXT NOT NULL,
 reference_round TEXT NOT NULL, deadline INTEGER NOT NULL, mandate_hash TEXT NOT NULL, evidence TEXT NOT NULL, request TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_wallet ON fill_intents(signer) WHERE status IN ('RESERVED','PENDING','REVIEW');
CREATE TABLE IF NOT EXISTS transactions(
 hash TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE REFERENCES fill_intents(id), signer TEXT NOT NULL,
 nonce INTEGER NOT NULL, chain_id INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(chain_id,signer,nonce)
);
CREATE TABLE IF NOT EXISTS receipts(intent_id TEXT PRIMARY KEY REFERENCES fill_intents(id), tx_hash TEXT NOT NULL UNIQUE, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), type TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON order_events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON order_events BEGIN SELECT RAISE(ABORT,'Events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS mandates_no_update BEFORE UPDATE ON mandates BEGIN SELECT RAISE(ABORT,'Confirmed mandate immutable'); END;
CREATE TRIGGER IF NOT EXISTS mandates_no_delete BEFORE DELETE ON mandates BEGIN SELECT RAISE(ABORT,'Confirmed mandate immutable'); END;
INSERT OR IGNORE INTO schema_migrations VALUES(1,unixepoch());
