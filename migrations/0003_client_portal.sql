ALTER TABLE clients ADD COLUMN portal_password_hash TEXT NOT NULL DEFAULT '';

ALTER TABLE clients ADD COLUMN portal_password_salt TEXT NOT NULL DEFAULT '';
