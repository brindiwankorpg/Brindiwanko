-- E-mail addresses confirmed by their owner: a link is sent at registration and at each change of address
-- (when a mail server is configured). A confirmed address is shown as such to the player and to the
-- administrators; nothing is refused to an address that is not confirmed.

ALTER TABLE accounts ADD COLUMN email_confirmed_at TEXT;   -- UTC datetime('now'); NULL = not confirmed

-- Confirmation links not used yet (one per account at most).
CREATE TABLE email_confirmations (
  token_hash TEXT PRIMARY KEY,                -- SHA-256 of the token, hex
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,                   -- address the link confirms: a later change of address makes it useless
  expires_at INTEGER NOT NULL                 -- Unix time in milliseconds
);
CREATE INDEX idx_email_confirmations_account ON email_confirmations(account_id);
