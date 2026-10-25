// Plays the real game on a phone-sized screen and frames moments from the run with captions, as store screenshots.
//
//   CHROMIUM=<path to a Chromium or chrome-headless-shell binary> node shots.mjs
//
// The page gets a debug hook (the same one scratchpad tests use) so an autopilot can strike every pose on time and
// the script can wait for each moment. Fonts are fetched through Node, so the browser needs no network of its own.

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../../', import.meta.url)), out = join(root, 'art');

// Each shot: its caption lines (the second is highlighted) and the in-game moment to capture, as an expression
// evaluated inside the game. They are taken in this order during one run.
const SHOTS = [
  { name: 'shot-2-pose', caption: ['STRIKE', 'A POSE!'], when: "game.done === 0 && walls[0] && player.pose === walls[0].pose && walls[0].z < 150" },
  { name: 'shot-1-smash', caption: ['SMASH', 'THROUGH WALLS!'], when: "popups.some(p => p.text !== 'GOOD' && p.age > 0.1 && p.age < 0.2)" },
  { name: 'shot-3-thief', caption: ['CATCH THE', 'PROTEIN THIEF!'], when: "bubble && bubble.age > 0.3 && game.level >= 2 && !popups.length" },
  { name: 'shot-4-crew', caption: ['GROW YOUR', 'GYM CREW!'], when: "game.crew.length === MAX_CREW && walls[0] && walls[0].z > 400 && popups.every(p => p.age > 0.5)" },
];
// Strikes each wall's pose just before it lands, inside the perfect window, and has the thief taunt now and then
// for the thief shot. The first wall is struck early, so the pose shot shows the wall still ahead.
const AUTOPILOT = `(function auto() {
  const w = walls[0], lead = game.done === 0 ? 0.45 : PERFECT_WIN * 0.5;
  if (state === 'run' && w && !w.auto && w.z / speed() < lead) { w.auto = true; strike(w.pose); }
  if (state === 'run' && !bubble && game.level >= 2 && Math.random() < 0.004) say(TAUNTS[1 + Math.floor(Math.random() * 4)], 2.5);
  requestAnimationFrame(auto);
})()`;

const html = readFileSync(join(root, 'index.html'), 'utf8'), end = html.lastIndexOf('})();');
const page = html.slice(0, end) + 'window.__dbg = c => eval(c);\n' + html.slice(end);
const server = createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== '/') { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(page);
}).listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--ignore-gpu-blocklist'] });
const tab = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
tab.on('pageerror', e => console.error(e));
await tab.route(/fonts\.(googleapis|gstatic)\.com/, async route => route.fulfill({ response: await route.fetch() }));
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.evaluate(() => document.fonts.ready);
await tab.click('#startBtn');
await tab.evaluate(code => window.__dbg(code), AUTOPILOT);

const shots = [];
for (const shot of SHOTS) {
  await tab.waitForFunction(when => window.__dbg(when), shot.when, { polling: 'raf', timeout: 120_000 });
  shots.push({ ...shot, png: (await tab.screenshot()).toString('base64') });
  console.log(`${shot.name}: captured`);
}

// Frames a shot on the Iron Temple sunset with its caption above, in the game's display font.
const framed = await tab.evaluate(async shots => {
  const INK = '#1d0f2e', SUN = '#ffd23f', CREAM = '#fff6e0', W = 1080, H = 1920;
  const result = [];
  for (const { name, caption, png } of shots) {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = W; c.height = H;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#ffb347'); sky.addColorStop(1, '#ff5e8a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    g.save(); g.translate(W / 2, 260); g.fillStyle = 'rgba(255, 241, 168, 0.25)';
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 2400, a, a + Math.PI / 20); g.fill(); }
    g.restore();

    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const sw = 860, sh = sw * img.height / img.width, sx = (W - sw) / 2, sy = H - sh - 40, r = 56;
    g.save();
    g.shadowColor = 'rgba(29, 15, 46, 0.45)'; g.shadowBlur = 40; g.shadowOffsetY = 18;
    g.beginPath(); g.roundRect(sx - 12, sy - 12, sw + 24, sh + 24, r + 12); g.fillStyle = INK; g.fill();
    g.restore();
    g.save(); g.beginPath(); g.roundRect(sx, sy, sw, sh, r); g.clip(); g.drawImage(img, sx, sy, sw, sh); g.restore();

    g.save(); g.translate(W / 2, 175); g.rotate(-0.04); g.transform(1, 0, -0.12, 1, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    caption.forEach((text, i) => {
      let size = i ? 124 : 92;
      g.font = `${size}px Bungee`;
      while (g.measureText(text).width > W * 0.86) g.font = `${--size}px Bungee`;
      const y = i ? 60 : -70;
      for (let d = 14; d > 0; d -= 2) { g.lineWidth = size * 0.22; g.strokeStyle = INK; g.strokeText(text, d * 0.4, y + d); }
      g.lineWidth = size * 0.22; g.strokeStyle = INK; g.strokeText(text, 0, y);
      g.fillStyle = i ? SUN : CREAM; g.fillText(text, 0, y);
    });
    g.restore();
    result.push({ name, jpg: c.toDataURL('image/jpeg', 0.9).split(',')[1] });
  }
  return result;
}, shots);

mkdirSync(out, { recursive: true });
for (const { name, jpg } of framed) writeFileSync(join(out, `${name}.jpg`), Buffer.from(jpg, 'base64'));
console.log(`Wrote ${framed.length} screenshots to ${out}`);
await browser.close();
server.close();
