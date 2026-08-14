ALTER TABLE clients ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'flat' CHECK (billing_model IN ('hourly', 'flat'));

ALTER TABLE invoices ADD COLUMN pricing_json TEXT NOT NULL DEFAULT '{}';
