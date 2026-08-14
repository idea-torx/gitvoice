CREATE INDEX IF NOT EXISTS idx_invoices_client_issued_at
ON invoices(client_id, issued_at DESC);

PRAGMA optimize;
