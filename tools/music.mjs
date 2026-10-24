// Embeds the soundtrack stems into index.html as AAC data URIs.
//
//   node tools/music.mjs [--loop <seconds>] <file>:<when> ...
//
// <when> is "run" for a stem that plays only during a run, or "always" for one
// that keeps playing on the title, pause and game-over screens. Every stem is
// trimmed to one shared loop length so they stay locked together; without
// --loop that length is the shortest stem, and stems more than 50 ms apart are
// rejected. Stems keep their relative levels: nothing is normalised per stem.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';

const args = process.argv.slice(2);
let loop = null;
if (args[0] === '--loop') { loop = Number(args[1]); args.splice(0, 2); }
const stems = args.map(a => {
  const i = a.lastIndexOf(':'), file = a.slice(0, i), when = a.slice(i + 1);
  if (i < 0 || !['run', 'always'].includes(when)) throw new Error(`Expected <file>:run or <file>:always, got "${a}"`);
  const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
  return { file, name: basename(file, extname(file)), paused: when === 'always', seconds };
});
if (!stems.length) throw new Error('Pass at least one <file>:<when> stem.');

const shortest = Math.min(...stems.map(s => s.seconds)), longest = Math.max(...stems.map(s => s.seconds));
if (loop === null) {
  if (longest - shortest > 0.05) throw new Error(`Stem lengths differ:\n${stems.map(s => `  ${s.name}: ${s.seconds.toFixed(3)} s`).join('\n')}\nPass --loop <seconds> to trim them all to one length.`);
  loop = shortest;
}
if (!(loop > 0 && loop <= shortest + 0.001)) throw new Error(`--loop must be between 0 and the shortest stem (${shortest.toFixed(3)} s).`);

const dir = mkdtempSync(join(tmpdir(), 'music-'));
const lines = stems.map(s => {
  const out = join(dir, `${s.name}.m4a`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', s.file, '-t', loop.toFixed(4), '-ac', '2', '-ar', '44100', '-c:a', 'aac', '-b:a', '96k', out]);
  const uri = `data:audio/mp4;base64,${readFileSync(out).toString('base64')}`;
  console.log(`${s.name}: ${s.paused ? 'always' : 'run only'}, ${(uri.length / 1024).toFixed(0)} KB`);
  return `  { name: ${JSON.stringify(s.name)}, paused: ${s.paused}, uri: '${uri}' },`;
});

const page = new URL('../index.html', import.meta.url);
const html = readFileSync(page, 'utf8');
const block = /<script id="music-art">[\s\S]*?<\/script>/;
if (!block.test(html)) throw new Error('index.html has no <script id="music-art"> block.');
writeFileSync(page, html.replace(block, () => `<script id="music-art">
// Soundtrack stems written by tools/music.mjs. They loop together every MUSIC_LOOP seconds; a stem with
// paused: true keeps playing on the title, pause and game-over screens, the rest only during a run.
const MUSIC_LOOP = ${loop.toFixed(4)};
const MUSIC = [
${lines.join('\n')}
];
</script>`));
console.log(`Wrote ${stems.length} stems, ${loop.toFixed(3)} s loop, into index.html.`);
