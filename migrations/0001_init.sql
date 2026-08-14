PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  github_repos TEXT NOT NULL DEFAULT '[]',
  github_author TEXT NOT NULL DEFAULT '',
  cadence TEXT NOT NULL DEFAULT 'manual' CHECK (cadence IN ('weekly', 'monthly', 'manual')),
  billing_day INTEGER NOT NULL DEFAULT 1,
  flat_amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  payment_terms TEXT NOT NULL DEFAULT 'Due on receipt',
  payment_days INTEGER NOT NULL DEFAULT 0,
  special_terms TEXT NOT NULL DEFAULT '',
  tax_rate REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('draft', 'generated', 'sent', 'paid', 'void')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal_cents INTEGER NOT NULL,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  pdf_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS invoices_client_period_idx ON invoices(client_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS invoices_created_idx ON invoices(created_at DESC);

INSERT OR IGNORE INTO settings (key, value) VALUES (
  'provider',
  '{"businessName":"Gitvoice","providerName":"Your name","address":"Your address\\nCity, Province, Country","email":"hello@example.com","website":"","taxId":"","remittance":"International wire transfer or direct deposit details go here.","logoUrl":""}'
);
