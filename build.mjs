import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const NAME = 'Gym Rush';
const DESCRIPTION = 'Chase a protein-stealing raccoon down winding roads and strike the pose cut into each wall.';
const BG = '#1d0f2e';
const SITE = 'https://justjammin.github.io/pump-parade/';
// Artwork made by tools/store-art: published name in dist/web → file in art/.
const WEB_ART = { 'icon-192.png': 'icon-192.png', 'icon-512.png': 'icon-512.png', 'apple-touch-icon.png': 'apple-touch-icon.png', 'social.jpg': 'social-1200x630.jpg' };

const source = readFileSync('index.html', 'utf8');
const split = source.indexOf('\n<div id="app">');
if (split < 0) throw new Error('index.html: expected a top-level <div id="app">');
const head = source.slice(0, split).replace(/<meta name="claude:[^>]*>\n/g, '').trim();
const body = source.slice(split).trim();
const hash = createHash('sha256').update(source).update(readFileSync('build.mjs'));
for (const file of Object.values(WEB_ART)) hash.update(readFileSync(`art/${file}`));
const version = hash.digest('hex').slice(0, 10);

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
mkdirSync('dist/crazygames', { recursive: true });

writeFileSync('dist/web/index.html', page({
  headExtra: `<meta name="theme-color" content="${BG}">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${NAME}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icon-192.png" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${NAME}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}social.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
`,
  bodyExtra: `<script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');</script>
`,
}));
writeFileSync('dist/web/manifest.webmanifest', JSON.stringify(manifest, null, 2) + '\n');
writeFileSync('dist/web/sw.js', serviceWorker);
for (const [name, file] of Object.entries(WEB_ART)) copyFileSync(`art/${file}`, `dist/web/${name}`);

writeFileSync('dist/itch/index.html', page());
copyFileSync('art/itch-cover-630x500.jpg', 'dist/itch-cover.jpg');
execFileSync('zip', ['-q', '-X', '../pump-parade-itch.zip', 'index.html'], { cwd: 'dist/itch' });

// CrazyGames wants its SDK in the head. The game picks the CrazyGames platform row once the SDK starts.
writeFileSync('dist/crazygames/index.html', page({
  headExtra: `<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
`,
}));
execFileSync('zip', ['-q', '-X', '../gym-rush-crazygames.zip', 'index.html'], { cwd: 'dist/crazygames' });

console.log(`Built ${version}: dist/web (installable web app), dist/itch + dist/pump-parade-itch.zip (itch.io), dist/itch-cover.jpg, dist/crazygames + dist/gym-rush-crazygames.zip (CrazyGames)`);
