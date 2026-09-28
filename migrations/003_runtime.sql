CREATE TABLE IF NOT EXISTS operator_sessions(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS worker_heartbeat(id TEXT PRIMARY KEY, observed_at INTEGER NOT NULL, execution_enabled INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS signed_transactions(intent_id TEXT PRIMARY KEY REFERENCES fill_intents(id), raw TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS signing_jobs(intent_id TEXT PRIMARY KEY REFERENCES fill_intents(id), body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_receipts(intent_id TEXT PRIMARY KEY REFERENCES fill_intents(id), body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS store_environment(id INTEGER PRIMARY KEY CHECK(id=1), environment TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations VALUES(3,unixepoch());
