// Records the silent gameplay preview videos for CrazyGames: landscape 16:9 and portrait 2:3, under 20 seconds,
// opening on the static cover.
//
//   CHROMIUM=<path to a Chromium or chrome-headless-shell binary> node video.mjs
//
// Needs ffmpeg on the PATH. The game runs on a virtual clock: Math.random is seeded, and the script steps the game's
// own frame loop and every CSS animation 1/60 s at a time. A run is the same run every time, and it plays at true
// speed however slowly the screenshots come.

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../../', import.meta.url)), art = join(root, 'art');
const SEED = 7, FPS = 60, SCAN_SECONDS = 90, COVER_HOLD = 0.5, FADE = 0.5;
// Players assume HD video is BT.709 in limited range, so the JPEG cover and the PNG frames are both converted to it.
const BT709 = 'out_color_matrix=bt709:out_range=tv';
const FORMATS = [
  { name: 'video-landscape-1920x1080', viewport: { width: 960, height: 540 }, cover: 'crazygames-landscape-1920x1080.jpg' },
  { name: 'video-portrait-1080x1620', viewport: { width: 540, height: 810 }, cover: 'crazygames-portrait-800x1200.jpg' },
];
// Clips cut from one run. Each starts `lead` seconds before its expression first holds inside the game. The layout
// changes how much randomness the scenery draws, so the two formats play different runs and need anchors, not times.
const CUTS = [
  { when: 'game.done >= 1', lead: 0.6, length: 4.8 },
  { when: 'game.district === 1', lead: 0.6, length: 3.7 },
  { when: 'meme', lead: 2.5, length: 4.9 },
  { when: 'game.district === 3', lead: 0.3, length: 4.0 },
];
// Strikes every wall inside the perfect window, except the third wall after reaching Bicep Beach (district 2), so
// the third clip shows half the crew dropping out. Then it steps the game and its CSS animations to `ms`.
const STEPPER = `(() => {
  let entered;
  const hits = [${CUTS.map(c => `() => (${c.when})`).join(', ')}];
  window.__step = ms => {
    if (game.district === 2 && entered === undefined) entered = game.done;
    const w = walls[0];
    if (state === 'run' && w && !w.auto && w.z / speed() < PERFECT_WIN * 0.5) { w.auto = true; if (game.done !== entered + 2) strike(w.pose); }
    window.__frame(ms);
    for (const a of document.getAnimations()) { if (a.t0 === undefined) { a.t0 = ms; a.pause(); } a.currentTime = ms - a.t0; }
    return hits.map(hit => hit());
  };
})()`;

const html = readFileSync(join(root, 'index.html'), 'utf8'), end = html.lastIndexOf('})();');
const page = html.slice(0, end) + 'window.__dbg = c => eval(c);\n' + html.slice(end);
const server = createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== '/') { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });

async function openRun(viewport) {
  const tab = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  tab.on('pageerror', e => console.error(e));
  await tab.addInitScript(seed => {
    let a = seed;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    window.requestAnimationFrame = frame => { window.__frame = frame; return 0; };
  }, SEED);
  await tab.route(/fonts\.(googleapis|gstatic)\.com/, async route => route.fulfill({ response: await route.fetch() }));
  await tab.goto(`http://127.0.0.1:${server.address().port}/`);
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(800);
  await tab.click('#startBtn');
  await tab.evaluate(code => window.__dbg(code), STEPPER);
  return tab;
}

for (const { name, viewport, cover } of FORMATS) {
  const scan = await openRun(viewport);
  const firsts = await scan.evaluate(({ frames, FPS }) => {
    const firsts = [];
    for (let i = 0; i < frames; i++) window.__step(i * 1000 / FPS).forEach((hit, k) => { if (hit && firsts[k] === undefined) firsts[k] = i; });
    return firsts;
  }, { frames: SCAN_SECONDS * FPS, FPS });
  await scan.close();
  const windows = CUTS.map((cut, k) => {
    if (firsts[k] === undefined) throw new Error(`${name}: "${cut.when}" never held in ${SCAN_SECONDS} s`);
    const from = firsts[k] - Math.round(cut.lead * FPS);
    return [from, from + Math.round(cut.length * FPS)];
  });
  console.log(`${name}: clips from ${windows.map(([a, b]) => `${(a / FPS).toFixed(2)}-${(b / FPS).toFixed(2)} s`).join(', ')}`);

  const { width, height } = viewport, out = join(art, `${name}.mp4`);
  const ffmpeg = spawn('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-framerate', String(FPS), '-t', String(COVER_HOLD + FADE), '-i', join(art, cover),
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-filter_complex', `[0]scale=${width * 2}:${height * 2}:flags=lanczos:${BT709},setsar=1,format=yuv420p[c];[1]scale=${BT709},setsar=1,format=yuv420p[g];[c][g]xfade=transition=fade:duration=${FADE}:offset=${COVER_HOLD},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const tab = await openRun(viewport);
  const last = Math.max(...windows.map(([, b]) => b));
  for (let i = 0; i < last; i++) {
    await tab.evaluate(ms => { window.__step(ms); }, i * 1000 / FPS);
    if (windows.some(([a, b]) => i >= a && i < b) && !ffmpeg.stdin.write(await tab.screenshot())) await once(ffmpeg.stdin, 'drain');
  }
  ffmpeg.stdin.end();
  const [code] = await once(ffmpeg, 'close');
  if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
  await tab.close();
  console.log(`Wrote ${out}`);
}
await browser.close();
server.close();
