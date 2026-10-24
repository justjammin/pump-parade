// Embeds the soundtrack stems into index.html as AAC data URIs.
//
//   node tools/music.mjs [--loop <seconds>] <name>=<file> ...
//
// <name> is the key the game's MUSIC_MIX table uses for that stem. Every stem is
// trimmed to one shared loop length so they stay locked together; without
// --loop that length is the shortest stem, and stems more than 50 ms apart are
// rejected. Stems keep their relative levels: nothing is normalised per stem.
//
// AAC codes the first and last frames of a file badly, which clicks at a loop
// seam. So each stem is written with PAD seconds of its own tail before the loop
// and its own head after it, and the game loops only the middle.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAD = 0.25, RATE = 44100;
const args = process.argv.slice(2);
let loop = null;
if (args[0] === '--loop') { loop = Number(args[1]); args.splice(0, 2); }
const stems = args.map(a => {
  const i = a.indexOf('='), name = a.slice(0, i), file = a.slice(i + 1);
  if (!/^[a-z]\w*$/i.test(name) || !file) throw new Error(`Expected <name>=<file>, got "${a}"`);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
  return { file, name, seconds };
});
if (!stems.length) throw new Error('Pass at least one <name>=<file> stem.');

const shortest = Math.min(...stems.map(s => s.seconds)), longest = Math.max(...stems.map(s => s.seconds));
if (loop === null) {
  if (longest - shortest > 0.05) throw new Error(`Stem lengths differ:\n${stems.map(s => `  ${s.name}: ${s.seconds.toFixed(3)} s`).join('\n')}\nPass --loop <seconds> to trim them all to one length.`);
  loop = shortest;
}
if (!(loop > 0 && loop <= shortest + 0.001)) throw new Error(`--loop must be between 0 and the shortest stem (${shortest.toFixed(3)} s).`);

const dir = mkdtempSync(join(tmpdir(), 'music-'));
const n = Math.round(loop * RATE), pad = Math.round(PAD * RATE);
const lines = stems.map(s => {
  const out = join(dir, `${s.name}.m4a`);
  const wrap = `aresample=${RATE},aloop=loop=2:size=${n},atrim=start_sample=${n - pad}:end_sample=${2 * n + pad},asetpts=PTS-STARTPTS`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', s.file, '-af', wrap, '-ac', '2', '-c:a', 'aac', '-b:a', '96k', out]);
  const uri = `data:audio/mp4;base64,${readFileSync(out).toString('base64')}`;
  console.log(`${s.name}: ${(uri.length / 1024).toFixed(0)} KB`);
  return `  { name: ${JSON.stringify(s.name)}, uri: '${uri}' },`;
});

const page = new URL('../index.html', import.meta.url);
const html = readFileSync(page, 'utf8');
const block = /<script id="music-art">[\s\S]*?<\/script>/;
if (!block.test(html)) throw new Error('index.html has no <script id="music-art"> block.');
writeFileSync(page, html.replace(block, () => `<script id="music-art">
// Soundtrack stems written by tools/music.mjs. They loop together every MUSIC_LOOP seconds, and
// MUSIC_MIX sets which ones are heard, and how loud, in each game state. Each stem starts with
// MUSIC_PAD seconds of its own tail and ends with as much of its head, so the loop is the part between.
const MUSIC_LOOP = ${(n / RATE).toFixed(4)}, MUSIC_PAD = ${PAD};
const MUSIC = [
${lines.join('\n')}
];
</script>`));
console.log(`Wrote ${stems.length} stems, ${(n / RATE).toFixed(3)} s loop, into index.html.`);
