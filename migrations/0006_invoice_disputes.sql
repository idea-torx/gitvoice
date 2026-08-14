CREATE TABLE IF NOT EXISTS invoice_disputes (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS invoice_disputes_client_idx ON invoice_disputes(client_id, created_at DESC);
