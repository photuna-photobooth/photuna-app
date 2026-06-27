
// gen-keys.js
const { generateKeyPairSync } = require('crypto');
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function toEnvMultiline(pem) {
  return JSON.stringify(pem.replace(/\r?\n/g, '\n')); // wraps in quotes, keeps \n
}

console.log('LICENSE_PRIVATE_KEY=' + toEnvMultiline(privateKey));
console.log('LICENSE_PUBLIC_KEY=' + toEnvMultiline(publicKey));
