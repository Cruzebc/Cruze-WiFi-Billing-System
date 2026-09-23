const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data', 'billing.sqlite'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL,
    package_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed | provisioned
    checkout_request_id TEXT,
    merchant_request_id TEXT,
    mpesa_receipt TEXT,
    voucher_code TEXT,
    failure_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_orders_checkout ON orders(checkout_request_id);

  CREATE TABLE IF NOT EXISTS vouchers (
    code TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    package_id TEXT NOT NULL,
    mikrotik_username TEXT NOT NULL,
    mikrotik_password TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    disconnected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_expiry ON vouchers(expires_at, disconnected);
`);

// Migration guard: if this file already exists from an earlier version of the
// schema (before expires_at/disconnected existed), add the missing columns
// instead of erroring out.
const voucherColumns = db.prepare('PRAGMA table_info(vouchers)').all().map((c) => c.name);
if (!voucherColumns.includes('expires_at')) {
  db.exec('ALTER TABLE vouchers ADD COLUMN expires_at TEXT');
}
if (!voucherColumns.includes('disconnected')) {
  db.exec('ALTER TABLE vouchers ADD COLUMN disconnected INTEGER NOT NULL DEFAULT 0');
}

module.exports = db;
