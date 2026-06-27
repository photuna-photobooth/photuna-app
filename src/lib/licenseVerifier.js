
// src/lib/licenseVerifier.js
// Minimal RS256 JWT verify with Web Crypto for browser builds.

function base64UrlToUint8Array(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function pemToArrayBuffer(pem) {
  const clean = pem.replace(/-----BEGIN PUBLIC KEY-----/g, '')
                   .replace(/-----END PUBLIC KEY-----/g, '')
                   .replace(/\s+/g, '');
  const binary = atob(clean);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
  return buf;
}

async function importPublicKey(pem) {
  const spki = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

function decodeJwt(token) {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Malformed JWT');
  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(h)));
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(p)));
  const signature = base64UrlToUint8Array(s);
  const signingInput = new TextEncoder().encode(`${h}.${p}`);
  return { header, payload, signature, signingInput };
}

/**
 * Verifies a RS256-signed license JWT and returns decoded claims.
 * @param {string} token - The JWT string
 * @param {string} publicKeyPem - RSA Public Key in PEM format
 * @returns {{ valid: boolean, header: object, payload: object }}
 */
export async function verifySignedLicense(token, publicKeyPem) {
  if (!token || !publicKeyPem) throw new Error('token_or_public_key_missing');

  const { header, payload, signature, signingInput } = decodeJwt(token);

  if (String(header.alg).toUpperCase() !== 'RS256') {
    throw new Error(`unsupported_alg:${header.alg}`);
  }

  const key = await importPublicKey(publicKeyPem);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    signature,
    signingInput
  );

  return { valid: !!ok, header, payload };
}

/**
 * Applies policy rules to the verified payload.
 * @param {{valid: boolean, header: object, payload: object}} v
 * @param {{expectedIssuer: string, expectedType: string, expectedUserId: string}} opts
 * @returns {{allow: boolean, reason: string}}
 */
export function isLicenseUsable(v, { expectedIssuer, expectedType, expectedUserId }) {
  if (!v || !v.valid) return { allow: false, reason: 'signature_invalid' };

  const nowSec = Math.floor(Date.now() / 1000);
  const { iss, typ, sub, exp } = v.payload || {};

  if (!iss || iss !== expectedIssuer) return { allow: false, reason: 'issuer_mismatch' };
  if (!typ || typ !== expectedType) return { allow: false, reason: 'type_mismatch' };
  if (!sub || sub !== expectedUserId) return { allow: false, reason: 'subject_mismatch' };
  if (!exp || nowSec >= exp) return { allow: false, reason: 'expired' };

  return { allow: true, reason: 'ok' };
}
