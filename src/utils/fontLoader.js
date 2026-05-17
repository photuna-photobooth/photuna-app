/**
 * Inject a Google Fonts <link> for the given font family name.
 * Idempotent — uses a stable element id so multiple calls are no-ops.
 */
export function loadGoogleFont(fontName) {
  if (!fontName || typeof document === 'undefined') return;
  const id = `google-font-${fontName.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontName.replace(/\s+/g, '+')}:wght@300;400;600;700&display=swap`;
  document.head.appendChild(link);
}
