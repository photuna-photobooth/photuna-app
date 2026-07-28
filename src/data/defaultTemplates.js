// src/data/defaultTemplates.js
// Pre-built templates and frames injected for Pro/Trial users on first login.

// ─── SVG helpers ───────────────────────────────────────────────────────────────

const enc = (svg) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' ').trim())}`;

function layoutThumb(slots, w, h) {
  const rects = slots
    .map(
      (s) =>
        `<rect x="${+(s.x * w).toFixed(1)}" y="${+(s.y * h).toFixed(1)}" ` +
        `width="${+(s.w * w).toFixed(1)}" height="${+(s.h * h).toFixed(1)}" ` +
        `fill="#cbd5e1" rx="2"/>`
    )
    .join('');
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#f1f5f9"/>` +
      rects +
      `</svg>`
  );
}

// Dual-strip thumbnail — dashed cut line, orientation auto-detected from w vs h
function dualStripThumb(slots, w, h) {
  const rects = slots
    .map(
      (s) =>
        `<rect x="${+(s.x * w).toFixed(1)}" y="${+(s.y * h).toFixed(1)}" ` +
        `width="${+(s.w * w).toFixed(1)}" height="${+(s.h * h).toFixed(1)}" ` +
        `fill="#cbd5e1" rx="2"/>`
    )
    .join('');
  const cut =
    w > h
      ? `<line x1="4" y1="${h / 2}" x2="${w - 4}" y2="${h / 2}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>`
      : `<line x1="${w / 2}" y1="4" x2="${w / 2}" y2="${h - 4}" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#f1f5f9"/>` +
      rects + cut +
      `</svg>`
  );
}

// ─── Frame SVG generators ──────────────────────────────────────────────────────

// 1. Studio White — clean white border, studio name centered at bottom strip
function studioWhiteFrame(w, h) {
  const bw = Math.round(Math.min(w, h) * 0.028);
  const sh = Math.max(18, Math.round(h * 0.075));
  const fz = Math.max(7, Math.round(sh * 0.46));
  const ls = Math.round(w * 0.008);
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<rect x="0" y="0" width="${w}" height="${bw}" fill="white"/>` +
      `<rect x="0" y="${h - bw}" width="${w}" height="${bw}" fill="white"/>` +
      `<rect x="0" y="0" width="${bw}" height="${h}" fill="white"/>` +
      `<rect x="${w - bw}" y="0" width="${bw}" height="${h}" fill="white"/>` +
      `<rect x="0" y="${h - sh}" width="${w}" height="${sh}" fill="white"/>` +
      `<text x="${w / 2}" y="${h - sh / 2 + fz * 0.38}" text-anchor="middle" ` +
      `font-family="Georgia,serif" font-size="${fz}" fill="#374151" letter-spacing="${ls}">STUDIO PHOTUNA</text>` +
      `</svg>`
  );
}

// 2. Noir & Gold — deep charcoal border with a thin champagne-gold inner accent line
function noirGoldFrame(w, h) {
  const bw = Math.round(Math.min(w, h) * 0.032);
  const gl = Math.max(1, Math.round(Math.min(w, h) * 0.0045));
  const go = bw + Math.round(gl * 0.5);
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<rect x="0" y="0" width="${w}" height="${bw}" fill="#111827"/>` +
      `<rect x="0" y="${h - bw}" width="${w}" height="${bw}" fill="#111827"/>` +
      `<rect x="0" y="0" width="${bw}" height="${h}" fill="#111827"/>` +
      `<rect x="${w - bw}" y="0" width="${bw}" height="${h}" fill="#111827"/>` +
      `<rect x="${go}" y="${go}" width="${w - go * 2}" height="${gl}" fill="#d4af37"/>` +
      `<rect x="${go}" y="${h - go - gl}" width="${w - go * 2}" height="${gl}" fill="#d4af37"/>` +
      `<rect x="${go}" y="${go}" width="${gl}" height="${h - go * 2}" fill="#d4af37"/>` +
      `<rect x="${w - go - gl}" y="${go}" width="${gl}" height="${h - go * 2}" fill="#d4af37"/>` +
      `</svg>`
  );
}

// 3. Rose Gold — gradient border cycling gold → champagne → rose → gold
function roseGoldFrame(w, h) {
  const bw = Math.round(Math.min(w, h) * 0.026);
  const id = `rg${w}x${h}`;
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      `<defs>` +
      `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0%" stop-color="#d4af37"/>` +
      `<stop offset="28%" stop-color="#f2d8b0"/>` +
      `<stop offset="55%" stop-color="#c2748a"/>` +
      `<stop offset="80%" stop-color="#f0c0a8"/>` +
      `<stop offset="100%" stop-color="#d4af37"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect x="0" y="0" width="${w}" height="${bw}" fill="url(#${id})"/>` +
      `<rect x="0" y="${h - bw}" width="${w}" height="${bw}" fill="url(#${id})"/>` +
      `<rect x="0" y="0" width="${bw}" height="${h}" fill="url(#${id})"/>` +
      `<rect x="${w - bw}" y="0" width="${bw}" height="${h}" fill="url(#${id})"/>` +
      `</svg>`
  );
}

// 4. Floral Corner — five-petal flower clusters at all four corners
function petalCornerFrame(w, h) {
  const cr = Math.round(Math.min(w, h) * 0.08);
  const pad = Math.round(cr * 0.72);
  const petColors = ['#fbcfe8', '#ddd6fe', '#bfdbfe', '#bbf7d0', '#fed7aa'];

  function flower(cx, cy) {
    let svg = '';
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const ox = +(cx + Math.cos(ang) * cr * 0.38).toFixed(1);
      const oy = +(cy + Math.sin(ang) * cr * 0.38).toFixed(1);
      const rx = Math.round(cr * 0.24);
      const ry = Math.round(cr * 0.43);
      const deg = Math.round((ang * 180) / Math.PI);
      svg +=
        `<ellipse cx="${ox}" cy="${oy}" rx="${rx}" ry="${ry}" ` +
        `transform="rotate(${deg},${ox},${oy})" ` +
        `fill="${petColors[i]}" opacity="0.88"/>`;
    }
    svg += `<circle cx="${cx}" cy="${cy}" r="${Math.round(cr * 0.16)}" fill="#fbbf24" opacity="0.95"/>`;
    return svg;
  }

  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      flower(pad, pad) +
      flower(w - pad, pad) +
      flower(pad, h - pad) +
      flower(w - pad, h - pad) +
      `</svg>`
  );
}

// 5. Film Classic — sprocket holes on sides for portrait strips, top/bottom for landscape strips,
//    and a refined corner-mark treatment for standard prints
function filmFrame(w, h) {
  const aspect = h / w;

  if (aspect > 1.5) {
    // Portrait strip (2×6): dark perforated columns on left and right
    const sw = Math.round(w * 0.115);
    const hw = Math.round(sw * 0.58);
    const hh = Math.round(hw * 0.70);
    const hx = Math.round((sw - hw) / 2);
    const gap = Math.round(hh * 0.55);
    let holes = '';
    let y = Math.round(gap * 0.5);
    while (y + hh < h) {
      holes +=
        `<rect x="${hx}" y="${y}" width="${hw}" height="${hh}" rx="1" fill="white"/>` +
        `<rect x="${w - hx - hw}" y="${y}" width="${hw}" height="${hh}" rx="1" fill="white"/>`;
      y += hh + gap;
    }
    return enc(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
        `<rect x="0" y="0" width="${sw}" height="${h}" fill="#1e293b"/>` +
        `<rect x="${w - sw}" y="0" width="${sw}" height="${h}" fill="#1e293b"/>` +
        holes +
        `</svg>`
    );
  }

  if (aspect < 0.67) {
    // Landscape strip (6×2): dark perforated rows on top and bottom
    const sh = Math.round(h * 0.115);
    const hw = Math.round(sh * 1.05);
    const hh = Math.round(sh * 0.58);
    const hy = Math.round((sh - hh) / 2);
    const gap = Math.round(hw * 0.52);
    let holes = '';
    let x = Math.round(gap * 0.5);
    while (x + hw < w) {
      holes +=
        `<rect x="${x}" y="${hy}" width="${hw}" height="${hh}" rx="1" fill="white"/>` +
        `<rect x="${x}" y="${h - hy - hh}" width="${hw}" height="${hh}" rx="1" fill="white"/>`;
      x += hw + gap;
    }
    return enc(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
        `<rect x="0" y="0" width="${w}" height="${sh}" fill="#1e293b"/>` +
        `<rect x="0" y="${h - sh}" width="${w}" height="${sh}" fill="#1e293b"/>` +
        holes +
        `</svg>`
    );
  }

  // Standard print (4×6, 6×4): L-shaped corner marks in dark slate
  const m = Math.round(Math.min(w, h) * 0.038);
  const lk = Math.round(Math.min(w, h) * 0.10);
  const lw = Math.max(2, Math.round(Math.min(w, h) * 0.004));
  const col = '#1e293b';
  const cr = (x, y, cw, ch) => `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" fill="${col}"/>`;
  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      cr(m, m, lk, lw) + cr(m, m, lw, lk) +
      cr(w - m - lk, m, lk, lw) + cr(w - m - lw, m, lw, lk) +
      cr(m, h - m - lw, lk, lw) + cr(m, h - m - lk, lw, lk) +
      cr(w - m - lk, h - m - lw, lk, lw) + cr(w - m - lw, h - m - lk, lw, lk) +
      `</svg>`
  );
}

// 6. Confetti — festive colored dots and tiny ribbons scattered around all four edges
function confettiFrame(w, h) {
  const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#34d399'];
  const bd = Math.round(Math.min(w, h) * 0.075);
  const baseR = Math.max(2, Math.round(Math.min(w, h) * 0.009));

  let seed = 31415;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 0xffffffff;
  };

  const count = Math.round((w + h) * 0.14);
  const shapes = [];
  for (let i = 0; i < count; i++) {
    const side = Math.floor(rng() * 4);
    const pos = rng();
    const d = rng() * bd;
    let x, y;
    if (side === 0)      { x = pos * w; y = d; }
    else if (side === 1) { x = pos * w; y = h - d; }
    else if (side === 2) { x = d;       y = pos * h; }
    else                 { x = w - d;   y = pos * h; }

    const r = Math.max(1, Math.round(baseR * (0.5 + rng() * 0.9)));
    const col = COLORS[Math.floor(rng() * COLORS.length)];
    const op = (0.65 + rng() * 0.35).toFixed(2);
    const rot = Math.round(rng() * 60 - 30);

    if (rng() > 0.55) {
      // Tiny ribbon / confetti strip
      const rw = r * 2;
      const rh = Math.round(r * 0.55);
      shapes.push(
        `<rect x="${(x - rw / 2).toFixed(1)}" y="${(y - rh / 2).toFixed(1)}" ` +
        `width="${rw}" height="${rh}" rx="1" fill="${col}" opacity="${op}" ` +
        `transform="rotate(${rot},${x.toFixed(1)},${y.toFixed(1)})"/>`
      );
    } else {
      shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${col}" opacity="${op}"/>`);
    }
  }

  return enc(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">` +
      shapes.join('') +
      `</svg>`
  );
}

// ─── Frame preview builder — all four layout sizes ─────────────────────────────

function mkPreviews(fn) {
  const LAYOUTS = { '2x6': [200, 600], '4x6': [400, 600], '6x2': [600, 200], '6x4': [600, 400] };
  const out = {};
  for (const [layout, [w, h]] of Object.entries(LAYOUTS)) {
    out[layout] = {
      originalDataUrl: fn(w, h),
      fileName: `default-frame-${layout}.svg`,
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
  }
  return out;
}

// ─── Slot helpers ──────────────────────────────────────────────────────────────

function mkSlots(pfx, defs) {
  return defs.map((d, i) => ({
    id: `${pfx}-slot-${i + 1}`,
    slotNumber: i + 1,
    rotation: 0,
    ...d,
  }));
}

// ─── Template slot definitions ─────────────────────────────────────────────────

// 2×6 Strip — portrait strip, 3 templates
const S26 = {
  // 4 equal photos, uniform spacing
  s4equal: mkSlots('2x6-a', [
    { x: 0.030, y: 0.030, w: 0.940, h: 0.218 },
    { x: 0.030, y: 0.264, w: 0.940, h: 0.218 },
    { x: 0.030, y: 0.498, w: 0.940, h: 0.218 },
    { x: 0.030, y: 0.732, w: 0.940, h: 0.218 },
  ]),
  // 3 large photos with bottom logo strip (12%)
  s3logo: mkSlots('2x6-b', [
    { x: 0.040, y: 0.028, w: 0.920, h: 0.270 },
    { x: 0.040, y: 0.314, w: 0.920, h: 0.270 },
    { x: 0.040, y: 0.600, w: 0.920, h: 0.270 },
  ]),
  // 4 photos with small header band at top (8% reserved)
  s4header: mkSlots('2x6-c', [
    { x: 0.040, y: 0.105, w: 0.920, h: 0.205 },
    { x: 0.040, y: 0.325, w: 0.920, h: 0.205 },
    { x: 0.040, y: 0.545, w: 0.920, h: 0.205 },
    { x: 0.040, y: 0.765, w: 0.920, h: 0.205 },
  ]),
};

// 6×2 Strip — landscape strip, 3 templates
const S62 = {
  // 4 equal photos side by side
  s4equal: mkSlots('6x2-a', [
    { x: 0.030, y: 0.030, w: 0.215, h: 0.940 },
    { x: 0.265, y: 0.030, w: 0.215, h: 0.940 },
    { x: 0.500, y: 0.030, w: 0.215, h: 0.940 },
    { x: 0.735, y: 0.030, w: 0.215, h: 0.940 },
  ]),
  // 3 wider photos
  s3wide: mkSlots('6x2-b', [
    { x: 0.030, y: 0.030, w: 0.293, h: 0.940 },
    { x: 0.353, y: 0.030, w: 0.293, h: 0.940 },
    { x: 0.676, y: 0.030, w: 0.293, h: 0.940 },
  ]),
  // 3 photos + right logo area (13% on right reserved for branding)
  s3logo: mkSlots('6x2-c', [
    { x: 0.030, y: 0.030, w: 0.245, h: 0.940 },
    { x: 0.295, y: 0.030, w: 0.245, h: 0.940 },
    { x: 0.560, y: 0.030, w: 0.245, h: 0.940 },
  ]),
};

// 4×6 Classic — portrait print, 3 templates
const C46 = {
  // Full-bleed single photo
  c1full: mkSlots('4x6-a', [
    { x: 0.030, y: 0.030, w: 0.940, h: 0.940 },
  ]),
  // 2×2 grid
  c4grid: mkSlots('4x6-b', [
    { x: 0.030, y: 0.030, w: 0.455, h: 0.455 },
    { x: 0.515, y: 0.030, w: 0.455, h: 0.455 },
    { x: 0.030, y: 0.515, w: 0.455, h: 0.455 },
    { x: 0.515, y: 0.515, w: 0.455, h: 0.455 },
  ]),
  // Large hero top + two portraits below
  c1hero2: mkSlots('4x6-c', [
    { x: 0.030, y: 0.030, w: 0.940, h: 0.530 },
    { x: 0.030, y: 0.580, w: 0.455, h: 0.390 },
    { x: 0.515, y: 0.580, w: 0.455, h: 0.390 },
  ]),
};

// 6×4 Classic — landscape print, 3 templates
const C64 = {
  // Full-bleed single photo
  c1full: mkSlots('6x4-a', [
    { x: 0.030, y: 0.030, w: 0.940, h: 0.940 },
  ]),
  // 2×2 grid
  c4grid: mkSlots('6x4-b', [
    { x: 0.030, y: 0.030, w: 0.455, h: 0.455 },
    { x: 0.515, y: 0.030, w: 0.455, h: 0.455 },
    { x: 0.030, y: 0.515, w: 0.455, h: 0.455 },
    { x: 0.515, y: 0.515, w: 0.455, h: 0.455 },
  ]),
  // Large left hero + two portraits stacked on right
  c1hero2: mkSlots('6x4-c', [
    { x: 0.030, y: 0.030, w: 0.565, h: 0.940 },
    { x: 0.620, y: 0.030, w: 0.350, h: 0.455 },
    { x: 0.620, y: 0.515, w: 0.350, h: 0.455 },
  ]),
};

// 4×6 Dual Strip — two portrait strips side-by-side, cut vertically down the middle
const D46 = {
  // 4 photos per strip → 8 captures
  d4dual: [
    { id: '4x6ds-l1', slotNumber: 1, rotation: 0, x: 0.025, y: 0.030, w: 0.450, h: 0.218 },
    { id: '4x6ds-l2', slotNumber: 2, rotation: 0, x: 0.025, y: 0.264, w: 0.450, h: 0.218 },
    { id: '4x6ds-l3', slotNumber: 3, rotation: 0, x: 0.025, y: 0.498, w: 0.450, h: 0.218 },
    { id: '4x6ds-l4', slotNumber: 4, rotation: 0, x: 0.025, y: 0.732, w: 0.450, h: 0.218 },
    { id: '4x6ds-r1', slotNumber: 5, rotation: 0, x: 0.525, y: 0.030, w: 0.450, h: 0.218 },
    { id: '4x6ds-r2', slotNumber: 6, rotation: 0, x: 0.525, y: 0.264, w: 0.450, h: 0.218 },
    { id: '4x6ds-r3', slotNumber: 7, rotation: 0, x: 0.525, y: 0.498, w: 0.450, h: 0.218 },
    { id: '4x6ds-r4', slotNumber: 8, rotation: 0, x: 0.525, y: 0.732, w: 0.450, h: 0.218 },
  ],
  // 3 photos per strip → 6 captures
  d3dual: [
    { id: '4x6dt-l1', slotNumber: 1, rotation: 0, x: 0.025, y: 0.025, w: 0.450, h: 0.293 },
    { id: '4x6dt-l2', slotNumber: 2, rotation: 0, x: 0.025, y: 0.343, w: 0.450, h: 0.293 },
    { id: '4x6dt-l3', slotNumber: 3, rotation: 0, x: 0.025, y: 0.661, w: 0.450, h: 0.293 },
    { id: '4x6dt-r1', slotNumber: 4, rotation: 0, x: 0.525, y: 0.025, w: 0.450, h: 0.293 },
    { id: '4x6dt-r2', slotNumber: 5, rotation: 0, x: 0.525, y: 0.343, w: 0.450, h: 0.293 },
    { id: '4x6dt-r3', slotNumber: 6, rotation: 0, x: 0.525, y: 0.661, w: 0.450, h: 0.293 },
  ],
  // 4 photos per strip + bottom logo space (12% reserved) → 8 captures
  d4logo: [
    { id: '4x6dl-l1', slotNumber: 1, rotation: 0, x: 0.025, y: 0.025, w: 0.450, h: 0.195 },
    { id: '4x6dl-l2', slotNumber: 2, rotation: 0, x: 0.025, y: 0.235, w: 0.450, h: 0.195 },
    { id: '4x6dl-l3', slotNumber: 3, rotation: 0, x: 0.025, y: 0.445, w: 0.450, h: 0.195 },
    { id: '4x6dl-l4', slotNumber: 4, rotation: 0, x: 0.025, y: 0.655, w: 0.450, h: 0.195 },
    { id: '4x6dl-r1', slotNumber: 5, rotation: 0, x: 0.525, y: 0.025, w: 0.450, h: 0.195 },
    { id: '4x6dl-r2', slotNumber: 6, rotation: 0, x: 0.525, y: 0.235, w: 0.450, h: 0.195 },
    { id: '4x6dl-r3', slotNumber: 7, rotation: 0, x: 0.525, y: 0.445, w: 0.450, h: 0.195 },
    { id: '4x6dl-r4', slotNumber: 8, rotation: 0, x: 0.525, y: 0.655, w: 0.450, h: 0.195 },
  ],
};

// 6×4 Dual Strip — two landscape strips stacked, cut horizontally across the middle
const D64 = {
  // 4 photos per strip → 8 captures
  d4dual: [
    { id: '6x4ds-t1', slotNumber: 1, rotation: 0, x: 0.030, y: 0.030, w: 0.215, h: 0.440 },
    { id: '6x4ds-t2', slotNumber: 2, rotation: 0, x: 0.265, y: 0.030, w: 0.215, h: 0.440 },
    { id: '6x4ds-t3', slotNumber: 3, rotation: 0, x: 0.500, y: 0.030, w: 0.215, h: 0.440 },
    { id: '6x4ds-t4', slotNumber: 4, rotation: 0, x: 0.735, y: 0.030, w: 0.215, h: 0.440 },
    { id: '6x4ds-b1', slotNumber: 5, rotation: 0, x: 0.030, y: 0.530, w: 0.215, h: 0.440 },
    { id: '6x4ds-b2', slotNumber: 6, rotation: 0, x: 0.265, y: 0.530, w: 0.215, h: 0.440 },
    { id: '6x4ds-b3', slotNumber: 7, rotation: 0, x: 0.500, y: 0.530, w: 0.215, h: 0.440 },
    { id: '6x4ds-b4', slotNumber: 8, rotation: 0, x: 0.735, y: 0.530, w: 0.215, h: 0.440 },
  ],
  // 3 photos per strip → 6 captures
  d3dual: [
    { id: '6x4dt-t1', slotNumber: 1, rotation: 0, x: 0.030, y: 0.030, w: 0.293, h: 0.440 },
    { id: '6x4dt-t2', slotNumber: 2, rotation: 0, x: 0.353, y: 0.030, w: 0.293, h: 0.440 },
    { id: '6x4dt-t3', slotNumber: 3, rotation: 0, x: 0.676, y: 0.030, w: 0.293, h: 0.440 },
    { id: '6x4dt-b1', slotNumber: 4, rotation: 0, x: 0.030, y: 0.530, w: 0.293, h: 0.440 },
    { id: '6x4dt-b2', slotNumber: 5, rotation: 0, x: 0.353, y: 0.530, w: 0.293, h: 0.440 },
    { id: '6x4dt-b3', slotNumber: 6, rotation: 0, x: 0.676, y: 0.530, w: 0.293, h: 0.440 },
  ],
  // 3 photos per strip + right logo area (14% reserved) → 6 captures
  d3logo: [
    { id: '6x4dl-t1', slotNumber: 1, rotation: 0, x: 0.030, y: 0.030, w: 0.242, h: 0.440 },
    { id: '6x4dl-t2', slotNumber: 2, rotation: 0, x: 0.292, y: 0.030, w: 0.242, h: 0.440 },
    { id: '6x4dl-t3', slotNumber: 3, rotation: 0, x: 0.554, y: 0.030, w: 0.242, h: 0.440 },
    { id: '6x4dl-b1', slotNumber: 4, rotation: 0, x: 0.030, y: 0.530, w: 0.242, h: 0.440 },
    { id: '6x4dl-b2', slotNumber: 5, rotation: 0, x: 0.292, y: 0.530, w: 0.242, h: 0.440 },
    { id: '6x4dl-b3', slotNumber: 6, rotation: 0, x: 0.554, y: 0.530, w: 0.242, h: 0.440 },
  ],
};

// ─── Template factory ──────────────────────────────────────────────────────────

function mkTemplate(id, name, layout, slotsArr, thumbFn, printMode = 'single') {
  const THUMB_SIZE = { '2x6': [100, 300], '4x6': [150, 225], '6x2': [300, 100], '6x4': [225, 150] };
  const [tw, th] = THUMB_SIZE[layout] ?? [150, 225];
  const genThumb = thumbFn ?? layoutThumb;
  return {
    id,
    name,
    isDefault: true,
    previewMeta: {
      layout,
      printMode,
      slots: slotsArr,
      thumbnailDataUrl: genThumb(slotsArr, tw, th),
    },
  };
}

// ─── Exports ───────────────────────────────────────────────────────────────────

export const DEFAULT_TEMPLATES = [
  // ── 2×6 Portrait Strip ──────────────────────────────────────────────────────
  mkTemplate('default-2x6-1', 'Strip 2x6 · 4 Equal',          '2x6', S26.s4equal),
  mkTemplate('default-2x6-2', 'Strip 2x6 · 3 Large + Logo',   '2x6', S26.s3logo),
  mkTemplate('default-2x6-3', 'Strip 2x6 · 4 + Header',       '2x6', S26.s4header),

  // ── 6×2 Landscape Strip ─────────────────────────────────────────────────────
  mkTemplate('default-6x2-1', 'Strip 6x2 · 4 Photos',         '6x2', S62.s4equal),
  mkTemplate('default-6x2-2', 'Strip 6x2 · 3 Wide',           '6x2', S62.s3wide),
  mkTemplate('default-6x2-3', 'Strip 6x2 · 3 + Logo',         '6x2', S62.s3logo),

  // ── 4×6 Portrait Print ──────────────────────────────────────────────────────
  mkTemplate('default-4x6-1', 'Classic 4x6 · Single',         '4x6', C46.c1full),
  mkTemplate('default-4x6-2', 'Classic 4x6 · 4 Grid',         '4x6', C46.c4grid),
  mkTemplate('default-4x6-3', 'Classic 4x6 · Hero + 2',       '4x6', C46.c1hero2),

  // ── 6×4 Landscape Print ─────────────────────────────────────────────────────
  mkTemplate('default-6x4-1', 'Classic 6x4 · Single',         '6x4', C64.c1full),
  mkTemplate('default-6x4-2', 'Classic 6x4 · 4 Grid',         '6x4', C64.c4grid),
  mkTemplate('default-6x4-3', 'Classic 6x4 · Hero + 2 Side',  '6x4', C64.c1hero2),

  // ── 4×6 Dual Strip (cut vertically) ─────────────────────────────────────────
  mkTemplate('default-4x6-ds1', '4x6 Strip · Dual 4+4',           '4x6', D46.d4dual, dualStripThumb, 'dual'),
  mkTemplate('default-4x6-ds2', '4x6 Strip · Dual 3+3',           '4x6', D46.d3dual, dualStripThumb, 'dual'),
  mkTemplate('default-4x6-ds3', '4x6 Strip · Dual 4+4 + Logo',    '4x6', D46.d4logo, dualStripThumb, 'dual'),

  // ── 6×4 Dual Strip (cut horizontally) ───────────────────────────────────────
  mkTemplate('default-6x4-ds1', '6x4 Strip · Dual 4+4',           '6x4', D64.d4dual, dualStripThumb, 'dual'),
  mkTemplate('default-6x4-ds2', '6x4 Strip · Dual 3+3',           '6x4', D64.d3dual, dualStripThumb, 'dual'),
  mkTemplate('default-6x4-ds3', '6x4 Strip · Dual 3+3 + Logo',    '6x4', D64.d3logo, dualStripThumb, 'dual'),
];

export const DEFAULT_FRAMES = [
  {
    id: 'default-frame-white',
    name: 'Studio White',
    isDefault: true,
    previews: mkPreviews(studioWhiteFrame),
  },
  {
    id: 'default-frame-noir-gold',
    name: 'Noir & Gold',
    isDefault: true,
    previews: mkPreviews(noirGoldFrame),
  },
  {
    id: 'default-frame-rose-gold',
    name: 'Rose Gold',
    isDefault: true,
    previews: mkPreviews(roseGoldFrame),
  },
  {
    id: 'default-frame-petals',
    name: 'Floral Corner',
    isDefault: true,
    previews: mkPreviews(petalCornerFrame),
  },
  {
    id: 'default-frame-film',
    name: 'Film Classic',
    isDefault: true,
    previews: mkPreviews(filmFrame),
  },
  {
    id: 'default-frame-confetti',
    name: 'Confetti',
    isDefault: true,
    previews: mkPreviews(confettiFrame),
  },
];

/**
 * Merge defaults into the user's existing template and frame libraries.
 * Idempotent — skips any item already present by ID.
 * Returns { nextTemplates, nextFrames, didInject }.
 */
export function mergeDefaults(existingTemplates = [], existingFrames = []) {
  const tplIds = new Set(existingTemplates.map((t) => t.id));
  const frmIds = new Set(existingFrames.map((f) => f.id));

  const newTpls = DEFAULT_TEMPLATES.filter((t) => !tplIds.has(t.id));
  const newFrms = DEFAULT_FRAMES.filter((f) => !frmIds.has(f.id));

  return {
    nextTemplates: newTpls.length ? [...newTpls, ...existingTemplates] : existingTemplates,
    nextFrames: newFrms.length ? [...newFrms, ...existingFrames] : existingFrames,
    didInject: newTpls.length > 0 || newFrms.length > 0,
  };
}
