-- Server-side admin sessions. Only the hash is stored, so the row cannot impersonate its owner,
-- and deleting the row revokes the credential immediately.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Login throttling lives in D1 because Workers isolates are recycled constantly and an
-- in-memory counter resets with them.
CREATE TABLE IF NOT EXISTS auth_attempts (
  address TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_address ON auth_attempts(address, attempted_at);
