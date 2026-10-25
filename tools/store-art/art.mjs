// Generates the store, portal and site artwork with the Higgsfield CLI, then crops each image to its exact size
// into ../../art, where the build and the store listings take it from.
//
//   node art.mjs [--force] [asset ...]
//
// Needs `higgsfield` on the PATH, signed in (`higgsfield auth login`). Raw generations are kept in raw/ (not
// checked in) and reused, so a rerun only spends credits on assets that have none yet; --force regenerates the
// named assets. Every asset takes the character sheet as its reference, so after regenerating the sheet,
// regenerate the rest too.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const MODEL = 'nano_banana_pro';
const raw = fileURLToPath(new URL('raw/', import.meta.url)), out = fileURLToPath(new URL('../../art/', import.meta.url));

// The game's palette (index.html) and characters, described in words so every image shares them.
const STYLE = 'Polished stylized 3D cartoon render in the style of top casual mobile games: soft cel shading, glossy highlights, thick dark purple (#1d0f2e) outlines, bright saturated warm palette of sunset orange #ffb347, hot pink #ff3d7f, sunny yellow #ffd23f and cream #fff6e0, with small teal #19d3c5 accents. Exaggerated proportions, energetic and funny.';
const HERO = 'a hugely muscular cartoon bodybuilder with a tall glossy black pompadour, tan skin, thick eyebrows, a cocky grin, hot pink posing trunks and black sneakers, with a massive chest and arms and chunky legs';
const THIEF = 'a chubby grey raccoon thief with a black bandit mask and a ringed tail, holding a huge hot-pink protein tub over its head';
const ACTION = 'The hero from the reference image, same design, smashes through a cracked cream gym wall mid-run in a double-biceps flex, chasing the raccoon thief from the reference image, same design, who flees with the pink protein tub. Wall chunks fly, an orange-to-pink sunburst glows behind, white speed lines streak past, and a few small electric-blue lightning bolts crackle around the hero.';
const TITLE = 'the game title "GYM RUSH" in huge chunky rounded bold game-logo letters, "GYM" filled yellow to orange and "RUSH" filled cream to pink, with a thick dark purple outline and a drop shadow, slightly tilted';
const ONLY_TITLE = 'The title is the only text in the image: no other words, letters, numbers, logos or watermarks.';

const SHEET = {
  aspect: '16:9',
  prompt: `Character design sheet on a plain white background, two original characters for a mobile runner game, full body, front three-quarter view, side by side. On the left the hero: ${HERO}, standing in a double-biceps flex. On the right the villain: ${THIEF}, mid-run. ${STYLE} No text.`,
};

// Each asset is generated from a prompt, or cropped from another asset's generation (`from`). `crop` picks the side
// kept when the aspect ratios differ. Icons are PNG, as the stores require; the rest are JPEG to keep the repo small.
const ASSETS = {
  'icon-512.png': {
    w: 512, h: 512, aspect: '1:1',
    prompt: `App icon artwork, square, no border. The hero from the reference image, same design, seen from the chest up, flexing both biceps with a cocky grin and bursting toward the viewer through a cracked cream gym wall, chunks flying, on a radiant orange-to-pink sunburst with white speed lines and a few small electric-blue lightning bolts. Keep the head and both fists inside the middle of the frame with a clear margin, since the corners get rounded off. ${STYLE} No text, letters or logos.`,
  },
  'icon-192.png': { w: 192, h: 192, from: 'icon-512.png' },
  'apple-touch-icon.png': { w: 180, h: 180, from: 'icon-512.png' },
  'feature-1024x500.jpg': {
    w: 1024, h: 500, aspect: '21:9', crop: 'left',
    prompt: `Wide promotional banner for a mobile game. On the left third, ${TITLE}. On the right two thirds: ${ACTION} Keep the title and characters away from the left and right edges. ${STYLE} ${ONLY_TITLE}`,
  },
  'crazygames-landscape-1920x1080.jpg': {
    w: 1920, h: 1080, aspect: '16:9',
    prompt: `Landscape cover art for a browser game. On the left third, ${TITLE}. On the right two thirds: ${ACTION} ${STYLE} ${ONLY_TITLE}`,
  },
  'social-1200x630.jpg': { w: 1200, h: 630, from: 'crazygames-landscape-1920x1080.jpg' },
  'crazygames-portrait-800x1200.jpg': {
    w: 800, h: 1200, aspect: '2:3',
    prompt: `Tall portrait cover art for a browser game. Across the top, ${TITLE}. Below it: ${ACTION} The hero charges toward the viewer and fills the middle; the raccoon flees in a lower corner. ${STYLE} ${ONLY_TITLE}`,
  },
  'crazygames-square-800x800.jpg': {
    w: 800, h: 800, aspect: '1:1',
    prompt: `Square cover art for a browser game. ${ACTION} The hero charges toward the viewer and fills most of the frame; the raccoon flees at one side. Across the bottom, ${TITLE}, on one line. ${STYLE} ${ONLY_TITLE}`,
  },
  'itch-cover-630x500.jpg': {
    w: 630, h: 500, aspect: '5:4',
    prompt: `Cover art for a browser game, slightly wider than square. Across the top, ${TITLE}. Below it: ${ACTION} The hero fills the middle; the raccoon flees in a lower corner. Keep the title and characters away from the edges. ${STYLE} ${ONLY_TITLE}`,
  },
};

const args = process.argv.slice(2), force = args[0] === '--force', named = force ? args.slice(1) : args;
const unknown = named.filter(n => n !== 'sheet' && !ASSETS[n]);
if (unknown.length) throw new Error(`Unknown asset: ${unknown.join(', ')}. Known: sheet, ${Object.keys(ASSETS).join(', ')}`);
mkdirSync(raw, { recursive: true });
mkdirSync(out, { recursive: true });

async function generate(name, { aspect, prompt }, refs = []) {
  const file = join(raw, `${name.replace(/\.\w+$/, '')}.png`);
  if (existsSync(file) && !(force && named.includes(name))) return file;
  const flags = ['--aspect_ratio', aspect, '--resolution', '2k', '--prompt', prompt, ...refs.flatMap(r => ['--image', r])];
  const [job] = JSON.parse(execFileSync('higgsfield', ['--json', 'generate', 'create', MODEL, ...flags, '--wait', '--wait-timeout', '10m'], { encoding: 'utf8' }));
  if (job.status !== 'completed') throw new Error(`${name}: job ${job.id} ${job.status}`);
  writeFileSync(file, Buffer.from(await (await fetch(job.result_url)).arrayBuffer()));
  console.log(`${name}: generated (job ${job.id})`);
  return file;
}

const sheet = await generate('sheet', SHEET);
for (const name of named.length ? named.filter(n => n !== 'sheet') : Object.keys(ASSETS)) {
  const { w, h, from, crop = 'centre', ...job } = ASSETS[name];
  const source = await generate(from ?? name, from ? ASSETS[from] : job, [sheet]);
  const image = sharp(source).resize(w, h, { fit: 'cover', position: crop });
  await (name.endsWith('.png') ? image.png() : image.jpeg({ quality: 90, mozjpeg: true })).toFile(join(out, name));
  console.log(`${name}: ${w}×${h}`);
}
