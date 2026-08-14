ALTER TABLE clients ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'wire'
  CHECK (payment_method IN ('etransfer', 'wire', 'alternative'));
