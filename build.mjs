import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const NAME = 'Gym Rush';
const DESCRIPTION = 'Chase a protein-stealing raccoon down winding roads and strike the pose cut into each wall.';
const BG = '#1d0f2e';

const source = readFileSync('index.html', 'utf8');
const split = source.indexOf('\n<div id="app">');
if (split < 0) throw new Error('index.html: expected a top-level <div id="app">');
const head = source.slice(0, split).replace(/<meta name="claude:[^>]*>\n/g, '').trim();
const body = source.slice(split).trim();
const version = createHash('sha256').update(source).update(readFileSync('build.mjs')).digest('hex').slice(0, 10);

function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`index.html: could not find "${start}" … "${end}"`);
  return source.slice(a, b);
}
const game = new Function('PI', 'TAU', [
  between('const mirror = p =>', 'const POSE_KEYS'),
  between('const INK =', '\n'),
  between('const PLAYER_COLORS =', '\n'),
  between('function figureShapes(', 'function drawFigure('),
  'return { POSES, INK, PLAYER_COLORS, figureShapes };',
].join('\n'))(Math.PI, Math.PI * 2);

// A Canvas2D stand-in that records what figureShapes draws as discs, capsules and polygons in device space.
function recorder() {
  const shapes = [], stack = [];
  let m = [1, 0, 0, 1, 0, 0], path = [];
  const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const unit = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const mul = (a, b, c, d, e, f) => {
    m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  };
  const current = () => path.at(-1) ?? (path.push({ pts: [] }), path.at(-1));
  const ctx = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'round', lineJoin: 'round',
    save() { stack.push([m, this.fillStyle, this.strokeStyle, this.lineWidth]); },
    restore() { [m, this.fillStyle, this.strokeStyle, this.lineWidth] = stack.pop(); },
    translate(x, y) { mul(1, 0, 0, 1, x, y); },
    scale(x, y) { mul(x, 0, 0, y, 0, 0); },
    rotate(a) { mul(Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0); },
    beginPath() { path = []; },
    moveTo(x, y) { path.push({ pts: [at(x, y)] }); },
    lineTo(x, y) { current().pts.push(at(x, y)); },
    quadraticCurveTo(qx, qy, x, y) {
      const sp = current(), p0 = sp.pts.at(-1), p1 = at(qx, qy), p2 = at(x, y);
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, u = 1 - t;
        sp.pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
      }
    },
    arc(x, y, r, a0, a1) {
      if (a1 - a0 >= Math.PI * 2 - 1e-6) { path.push({ disc: [...at(x, y), r * unit()] }); return; }
      const sp = current();
      for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * i / 24; sp.pts.push(at(x + r * Math.cos(a), y + r * Math.sin(a))); }
    },
    closePath() { current().closed = true; },
    fillRect(x, y, w, h) { shapes.push({ kind: 'poly', pts: [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)], color: this.fillStyle }); },
    fill() {
      for (const sp of path) {
        if (sp.disc) shapes.push({ kind: 'disc', c: sp.disc, color: this.fillStyle });
        else if (sp.pts.length > 2) shapes.push({ kind: 'poly', pts: sp.pts, color: this.fillStyle });
      }
    },
    stroke() {
      const r = this.lineWidth * unit() / 2;
      for (const sp of path) {
        if (sp.disc) continue;
        const pts = sp.closed ? [...sp.pts, sp.pts[0]] : sp.pts;
        for (let i = 1; i < pts.length; i++) shapes.push({ kind: 'capsule', a: pts[i - 1], b: pts[i], r, color: this.strokeStyle });
      }
    },
  };
  return { ctx, shapes };
}

function parseColor(c) {
  if (c.startsWith('#')) { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255, 1]; }
  const v = c.match(/[\d.]+/g).map(Number);
  return [v[0], v[1], v[2], v[3] ?? 1];
}

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

function shapeInfo(s) {
  if (s.kind === 'disc') { const [x, y, r] = s.c; return { box: [x - r, y - r, x + r, y + r], sdf: (px, py) => Math.hypot(px - x, py - y) - r }; }
  if (s.kind === 'capsule') {
    return {
      box: [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r],
      sdf: (px, py) => segDist(px, py, s.a, s.b) - s.r,
    };
  }
  const xs = s.pts.map(p => p[0]), ys = s.pts.map(p => p[1]);
  return {
    box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    sdf(px, py) {
      let d = Infinity, inside = false;
      for (let i = 0, j = s.pts.length - 1; i < s.pts.length; j = i++) {
        const [xi, yi] = s.pts[i], [xj, yj] = s.pts[j];
        d = Math.min(d, segDist(px, py, s.pts[j], s.pts[i]));
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside ? -d : d;
    },
  };
}

function rasterize(w, h, background, shapes) {
  const px = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const [r, g, b] = background(y + 0.5);
    for (let x = 0; x < w; x++) px.set([r, g, b], (y * w + x) * 3);
  }
  for (const s of shapes) {
    const [r, g, b, a] = parseColor(s.color), { box, sdf } = shapeInfo(s);
    const x0 = Math.max(0, Math.floor(box[0] - 1)), x1 = Math.min(w, Math.ceil(box[2] + 1));
    const y0 = Math.max(0, Math.floor(box[1] - 1)), y1 = Math.min(h, Math.ceil(box[3] + 1));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const cov = Math.max(0, Math.min(1, 0.5 - sdf(x + 0.5, y + 0.5))) * a;
      if (!cov) continue;
      const i = (y * w + x) * 3;
      px[i] += (r - px[i]) * cov; px[i + 1] += (g - px[i + 1]) * cov; px[i + 2] += (b - px[i + 2]) * cov;
    }
  }
  return px;
}

const CRC = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), td = Buffer.concat([Buffer.from(type), data]);
  let c = 0xffffffff;
  for (const byte of td) c = CRC[(c ^ byte) & 255] ^ (c >>> 8);
  out.writeUInt32BE(data.length, 0); td.copy(out, 4); out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
function png(w, h, px) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = Math.round(px[y * w * 3 + x]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Iron Temple sky, a striped sunset sun, and the player in a double-biceps pose sized to stay inside maskable safe zones.
function art(w, h, figureFrac) {
  const top = parseColor('#ffb347'), bottom = parseColor('#ff5e8a');
  const sky = y => top.slice(0, 3).map((v, i) => v + (bottom[i] - v) * (y / h));
  const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const { ctx, shapes } = recorder();
  const k = h * figureFrac / 203, feet = h / 2 + 95.5 * k, sunR = Math.min(w, h) * 0.36;
  ctx.fillStyle = '#fff1a8';
  ctx.beginPath(); ctx.arc(w / 2, h * 0.47, sunR, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const y = h * 0.47 + sunR * (0.12 + i * 0.22), sh = sunR * 0.05 * (1 + i * 0.6);
    ctx.fillStyle = toHex(sky(y + sh / 2));
    ctx.fillRect(w / 2 - sunR - 2, y, 2 * sunR + 4, sh);
  }
  ctx.strokeStyle = 'rgba(29,15,46,.3)'; ctx.lineWidth = 16 * k;
  ctx.beginPath(); ctx.moveTo(w / 2 - 40 * k, feet + 2 * k); ctx.lineTo(w / 2 + 40 * k, feet + 2 * k); ctx.stroke();
  const pose = { x: w / 2, y: feet, k, stance: 1 };
  game.figureShapes(ctx, game.POSES.up, pose, () => game.INK, 9);
  game.figureShapes(ctx, game.POSES.up, { ...pose, detail: true }, p => game.PLAYER_COLORS[p], 0);
  return png(w, h, rasterize(w, h, sky, shapes));
}

function page({ headExtra = '', bodyExtra = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${DESCRIPTION}">
${headExtra}${head}
</head>
<body>
${body}
${bodyExtra}</body>
</html>
`;
}

const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const serviceWorker = `const CACHE = 'pump-parade-${version}';
const SHELL = ${JSON.stringify(SHELL)};

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
));

const keep = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; };

// Pages go network-first so a new deploy shows up on the next online launch; fonts and icons never change, so cache-first.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => keep('index.html', res)).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => (res.ok || res.type === 'opaque' ? keep(req, res) : res))));
});
`;

const manifest = {
  name: NAME,
  short_name: NAME,
  description: DESCRIPTION,
  start_url: './',
  scope: './',
  display: 'fullscreen',
  orientation: 'any',
  background_color: BG,
  theme_color: BG,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/web', { recursive: true });
mkdirSync('dist/itch', { recursive: true });

writeFileSync('dist/web/index.html', page({
  headExtra: `<meta name="theme-color" content="${BG}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${NAME}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
`,
  bodyExtra: `<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');</script>
`,
}));
writeFileSync('dist/web/manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
writeFileSync('dist/web/sw.js', serviceWorker);
writeFileSync('dist/web/icon-192.png', art(192, 192, 0.58));
writeFileSync('dist/web/icon-512.png', art(512, 512, 0.58));
writeFileSync('dist/web/apple-touch-icon.png', art(180, 180, 0.58));

writeFileSync('dist/itch/index.html', page());
writeFileSync('dist/itch-cover.png', art(630, 500, 0.72));
execFileSync('zip', ['-q', '-X', '../pump-parade-itch.zip', 'index.html'], { cwd: 'dist/itch' });

console.log(`Built ${version}: dist/web (installable web app), dist/itch + dist/pump-parade-itch.zip (itch.io), dist/itch-cover.png`);
