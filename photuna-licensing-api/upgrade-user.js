// upgrade-user.js — manually set a user's license plan in SQLite
// Usage: TARGET_USER_ID=<supabase-uuid> PLAN=yearly node upgrade-user.js
//
// PLAN options: free | trial | monthly | yearly

const path = require('path');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const TARGET_USER_ID = process.env.TARGET_USER_ID;
const PLAN = process.env.PLAN || 'yearly';

if (!TARGET_USER_ID) {
  console.error('ERROR: set TARGET_USER_ID env var to the user\'s Supabase UUID');
  console.error('  Example: TARGET_USER_ID=abc-123 PLAN=yearly node upgrade-user.js');
  process.exit(1);
}

const ENTITLEMENTS = {
  free:    { watermark: true,  maxEvents: 1,    templates: 3,   prioritySupport: false, plan: 'free' },
  trial:   { watermark: true,  maxEvents: 1,    templates: 5,   prioritySupport: false, plan: 'trial' },
  monthly: { watermark: false, maxEvents: 100,  templates: 999, prioritySupport: true,  plan: 'monthly' },
  yearly:  { watermark: false, maxEvents: 1000, templates: 999, prioritySupport: true,  plan: 'yearly' },
};

if (!ENTITLEMENTS[PLAN]) {
  console.error(`ERROR: unknown plan "${PLAN}". Use: free | trial | monthly | yearly`);
  process.exit(1);
}

const nowSec = () => Math.floor(Date.now() / 1000);

function expiresFor(plan) {
  if (plan === 'yearly')  return nowSec() + 365 * 24 * 3600;
  if (plan === 'monthly') return nowSec() + 30  * 24 * 3600;
  if (plan === 'trial')   return nowSec() + 7   * 24 * 3600;
  return 0; // free = no expiry
}

function stateFor(plan) {
  if (plan === 'trial') return 'trialing';
  if (plan === 'free')  return 'active';
  return 'active';
}

const DB_PATH = path.join(__dirname, 'db.sqlite');
const db = new Database(DB_PATH);

const entitlements = ENTITLEMENTS[PLAN];
const expires = expiresFor(PLAN);
const state = stateFor(PLAN);

const existing = db.prepare('SELECT id FROM licenses WHERE user_id = ?').get(TARGET_USER_ID);

if (existing) {
  db.prepare(`
    UPDATE licenses
    SET plan = ?, state = ?, entitlements_json = ?, current_period_end = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(PLAN, state, JSON.stringify(entitlements), expires, existing.id);
  console.log(`Updated license ${existing.id} → plan=${PLAN}, state=${state}, expires=${new Date(expires * 1000).toISOString()}`);
} else {
  const id = nanoid();
  db.prepare(`
    INSERT INTO licenses (id, user_id, plan, state, entitlements_json, current_period_end)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, TARGET_USER_ID, PLAN, state, JSON.stringify(entitlements), expires);
  console.log(`Inserted new license ${id} → plan=${PLAN}, state=${state}, expires=${new Date(expires * 1000).toISOString()}`);
}

db.close();
console.log('Done.');
