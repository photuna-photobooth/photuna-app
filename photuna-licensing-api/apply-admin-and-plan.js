/**
 * apply-admin-and-plan-sqlite.js
 *
 * - Promotes TARGET_EMAIL to admin (creates if missing)
 * - Applies subscription plan (PLAN) with EXPIRY_DATE
 *
 * Usage:
 *   node apply-admin-and-plan-sqlite.js
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const dayjs = require('dayjs');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  SQLITE_DB_PATH = './5c0d638a-8bfc-4b48-8fcc-12ebfe7b8355.sqlite',
  TARGET_EMAIL = 'admin@studiophotuna.com',
  TARGET_NAME = 'Admin User',
  PLAN = 'yearly',
  EXPIRY_DATE = '2026-12-31',
} = process.env;

// Entitlements map
const ENTITLEMENTS = {
  yearly: { watermark: false, maxEvents: 999, templates: 999, prioritySupport: true },
  monthly: { watermark: false, maxEvents: 999, templates: 999, prioritySupport: false },
  trial: { watermark: true, maxEvents: 3, templates: 3, prioritySupport: false },
};

const expiresAt = dayjs(EXPIRY_DATE).startOf('day').unix();
if (!expiresAt) {
  console.error('Invalid EXPIRY_DATE (YYYY-MM-DD)');
  process.exit(1);
}

const entitlement = ENTITLEMENTS[PLAN] || ENTITLEMENTS.yearly;

const db = new sqlite3.Database(path.resolve(SQLITE_DB_PATH));

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

(async function main() {
  try {
    console.log(`[SQLite] Using database: ${SQLITE_DB_PATH}`);

    // Check if user exists
    let user = await get(`SELECT id FROM users WHERE email = ?`, [TARGET_EMAIL]);

    if (!user) {
      console.log(`[SQLite] User not found. Creating user: ${TARGET_EMAIL}`);
      const newId = randomUUID();
      // For a new user, we just set a dummy password hash
      const dummyPasswordHash = randomUUID();
      await run(
        `INSERT INTO users (id, email, password_hash, name, role, created_at)
         VALUES (?, ?, ?, ?, 'admin', datetime('now'))`,
        [newId, TARGET_EMAIL, dummyPasswordHash, TARGET_NAME]
      );
      user = { id: newId };
    } else {
      console.log(`[SQLite] Promoting existing user to admin: ${TARGET_EMAIL}`);
      await run(`UPDATE users SET role = 'admin' WHERE email = ?`, [TARGET_EMAIL]);
    }

    // Apply subscription
    console.log(`[SQLite] Applying subscription plan '${PLAN}' to user`);
    await run(
      `
      INSERT INTO licenses (userId, plan, state, expiresAt, entitlements, created_at)
      VALUES (?, ?, 'active', ?, ?, datetime('now'))
      ON CONFLICT(userId) DO UPDATE SET
        plan = excluded.plan,
        state = 'active',
        expiresAt = excluded.expiresAt,
        entitlements = excluded.entitlements
      `,
      [user.id, PLAN, expiresAt, JSON.stringify(entitlement)]
    );

    console.log('✅ Done.');
  } catch (err) {
    console.error('❌ Failed:', err.message || err);
  } finally {
    db.close();
  }
})();
