
// previewRouter.js
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime');

function indexSessionByToken(dataRoot) {
  const map = new Map();
  if (!fs.existsSync(dataRoot)) return map;
  for (const sid of fs.readdirSync(dataRoot)) {
    const p = path.join(dataRoot, sid, 'session.json');
    if (fs.existsSync(p)) {
      const j = fs.readJsonSync(p);
      if (j?.token) map.set(j.token, { dir: path.join(dataRoot, sid), meta: j });
    }
  }
  return map;
}

function createPreviewRouter({ dataRoot, clientDir }) {
  const router = express.Router();

  const resolveByToken = (token) => {
    // In production you can cache this map; here re-scan for simplicity
    const map = indexSessionByToken(dataRoot);
    return map.get(token) || null;
  };

  // API: JSON for mobile preview
  router.get('/api/session/:token', async (req, res) => {
    const entry = resolveByToken(req.params.token);
    if (!entry) return res.status(404).json({ error: 'not_found' });

    const { meta } = entry;

    // Encode by path segment so / stays intact
    const toUrl = (p) => {
      if (!p) return null;
      return `/media/${meta.token}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
    };

    res.json({
      sessionId: meta.sessionId,
      createdAt: meta.createdAt,
      shots: (meta.shots || []).map(s => ({ ...s, url: toUrl(s.path) })),
      slots: (meta.slots || []).map(s => ({
        ...s,
        imageUrl: toUrl(s.image),
        videoUrl: toUrl(s.video),
        gifUrl:   toUrl(s.gif)
      })),
      finalPrintUrl: toUrl(meta.finalPrint),
      animatedCompositeUrl: toUrl(meta.animatedComposite),
      layout: meta.layout
    });
  });

  // Media: stream files (token-scoped) — support nested rel paths
  router.get('/media/:token/:rel(.*)', async (req, res) => {
    const entry = resolveByToken(req.params.token);
    if (!entry) return res.status(404).end();

    const rel = decodeURIComponent(req.params.rel || '');
    const safeRel = rel.replace(/\\/g, '/');

    // Strong traversal guard
    const abs = path.resolve(entry.dir, safeRel);
    const inside = !path.relative(entry.dir, abs).startsWith('..');
    if (!inside) return res.status(403).end();

    if (!(await fs.pathExists(abs))) return res.status(404).end();

    res.setHeader('Content-Type', mime.getType(abs) || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    fs.createReadStream(abs).pipe(res);
  });

  // SPA (built mobile preview client)
  if (clientDir && fs.existsSync(clientDir)) {
    router.use(express.static(clientDir));
    router.get('/p/:token', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
  }

  return router;
}

module.exports = { createPreviewRouter };
