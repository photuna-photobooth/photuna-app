
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  email_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  role TEXT,
  plan TEXT,
  trial_redeemed INTEGER DEFAULT 0
);


CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,  -- unix ts
  revoked INTEGER DEFAULT 0,    -- 0=false, 1=true
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);



CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL,              -- free|trial|monthly|yearly
  state TEXT NOT NULL,             -- trialing|active|past_due|canceled|expired
  entitlements_json TEXT NOT NULL, -- JSON string of entitlements
  current_period_end INTEGER,      -- unix ts (0 for free)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id);

CREATE TRIGGER IF NOT EXISTS licenses_updated_at
AFTER UPDATE ON licenses
FOR EACH ROW
BEGIN
  UPDATE licenses SET updated_at = datetime('now') WHERE id = NEW.id;
END;



CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT,                 -- active, past_due, canceled, trialing, unpaid
  current_period_end INTEGER,  -- unix ts
  plan TEXT,                   -- monthly|yearly (reflects Stripe)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TRIGGER IF NOT EXISTS subscriptions_updated_at
AFTER UPDATE ON subscriptions
FOR EACH ROW
BEGIN
  UPDATE subscriptions SET updated_at = datetime('now') WHERE id = NEW.id;
END;



CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  platform TEXT,
  last_seen TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

CREATE TRIGGER IF NOT EXISTS devices_updated_at
AFTER UPDATE ON devices
FOR EACH ROW
BEGIN
  UPDATE devices SET updated_at = datetime('now') WHERE id = NEW.id;
END;

