-- Binds a database file to one chain so mainnet and testnet orders can never mix.
CREATE TABLE IF NOT EXISTS store_network(id INTEGER PRIMARY KEY CHECK(id=1), chain_id INTEGER NOT NULL, bound_at INTEGER NOT NULL);
-- Inclusion-time measurements (sender balance delta, reference round) taken when a receipt is
-- first seen, keyed by inclusion block: a pruned node cannot serve that state by finality.
CREATE TABLE IF NOT EXISTS inclusion_measurements(tx_hash TEXT NOT NULL, block_hash TEXT NOT NULL, body TEXT NOT NULL, measured_at INTEGER NOT NULL, PRIMARY KEY(tx_hash, block_hash));
INSERT OR IGNORE INTO schema_migrations VALUES(2,unixepoch());
