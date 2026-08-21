-- Dedicated admin_state table so settings writes can never wipe onboarding
CREATE TABLE IF NOT EXISTS admin_state (
  id TEXT PRIMARY KEY CHECK (id = 'singleton'),
  onboarded INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT '',
  password_salt TEXT NOT NULL DEFAULT '',
  recovery_hash TEXT NOT NULL DEFAULT '',
  recovery_salt TEXT NOT NULL DEFAULT '',
  setup_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO admin_state (id, onboarded, password_hash, password_salt, recovery_hash, recovery_salt, setup_at)
SELECT 'singleton', 1, json_extract(value, '$.passwordHash'), json_extract(value, '$.passwordSalt'), json_extract(value, '$.recoveryHash'), json_extract(value, '$.recoverySalt'), json_extract(value, '$.setupAt')
FROM settings WHERE key = 'admin' AND json_valid(value);

-- R2 backup marker (no DDL, just ensure admin_state exists for scheduled backup)
