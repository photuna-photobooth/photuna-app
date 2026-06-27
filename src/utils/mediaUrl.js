/**
 * Normalize any local path or URL into a value safe for <img src> / <video src>.
 * Handles: data URIs, http(s), app://, file://, Windows drive paths, bare POSIX paths.
 */
export function normalizeToFileUrl(raw) {
  if (!raw) return raw;
  if (typeof raw === 'string' && raw.startsWith('data:')) return raw;
  if (
    typeof raw === 'string' &&
    (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('app://'))
  ) {
    return raw;
  }

  let p = String(raw).replace(/\\/g, '/');

  if (p.startsWith('file:')) {
    p = 'file:///' + p.replace(/^file:\/+/, '').replace(/^\/+/, '');
    return encodeURI(p);
  }
  if (p.startsWith('/')) return encodeURI('file://' + p);
  if (/^[A-Za-z]:\//.test(p)) return encodeURI('file:///' + p);
  return encodeURI('file:///' + p.replace(/^\/+/, ''));
}
