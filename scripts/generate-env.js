// Bake the main process's public configuration into the packaged app.
//
// The renderer gets REACT_APP_* values inlined by CRA at build time, so it works
// anywhere. The main process does not: it reads process.env at runtime and fills
// it from a .env file on disk. No .env is shipped in the installer, so in every
// packaged build main had no Supabase URL or anon key, could not build a client,
// and threw before making a single request. That is why online galleries worked
// on a development machine and nowhere else.
//
// This writes those values into a module that ships inside the asar.
//
// ONLY public values belong here — the same ones already inlined into the
// renderer bundle. The allowlist is the safeguard: a service-role key must never
// reach a customer's machine, so it can never be added to this list.

const fs = require("fs");
const path = require("path");

const PUBLIC_KEYS = [
  "REACT_APP_SUPABASE_URL",
  "REACT_APP_SUPABASE_ANON_KEY",
  "REACT_APP_LICENSE_PUBLIC_KEY",
];

// Anything matching this must never be written, whatever the allowlist says.
const FORBIDDEN = /(SERVICE_ROLE|SECRET|PRIVATE_KEY|_SK$|^SK_)/i;

function loadDotEnv() {
  const file = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[m[1]] = value;
  }
  return out;
}

const fromFile = loadDotEnv();
const values = {};
const missing = [];

for (const key of PUBLIC_KEYS) {
  if (FORBIDDEN.test(key)) {
    throw new Error(`Refusing to bake ${key} into the app: it looks like a secret.`);
  }
  const value = process.env[key] || fromFile[key] || "";
  if (!value) missing.push(key);
  else values[key] = value;
}

if (missing.length) {
  // A build without these produces an app that cannot reach Supabase from main,
  // which is the failure this script exists to prevent. Fail loudly instead.
  console.error(
    `[generate-env] missing required public configuration: ${missing.join(", ")}\n` +
      `[generate-env] add them to .env at the repo root, or set them in the environment.`
  );
  process.exit(1);
}

const target = path.join(__dirname, "..", "electron", "env.generated.js");
const banner =
  "// GENERATED at build time by scripts/generate-env.js — do not edit, do not commit.\n" +
  "// Public configuration only; see that script for why this file exists.\n";

fs.writeFileSync(target, `${banner}module.exports = ${JSON.stringify(values, null, 2)};\n`);

console.log(
  `[generate-env] wrote electron/env.generated.js with ${Object.keys(values).length} public value(s)`
);
