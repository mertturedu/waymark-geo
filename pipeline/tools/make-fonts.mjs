/* global process, console */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FACES = { Regular: 'Inter-Regular.ttf', Medium: 'Inter-Medium.ttf', Italic: 'Inter-Italic.ttf', Bold: 'Inter-Bold.ttf' };
export const RANGE = 256;
export const LAST = 65535;

export const rangeNames = () => Array.from({ length: (LAST + 1) / RANGE }, (_, i) => `${i * RANGE}-${i * RANGE + RANGE - 1}`);

const makeRange = (fontnik, font, start, end) =>
  new Promise((done, fail) => fontnik.range({ font, start, end }, (error, data) => (error ? fail(error) : done(data))));

export const mergeRange = (fontnik, parts) => (parts.length === 1 ? Promise.resolve(parts[0]) : new Promise((done, fail) => fontnik.composite(parts, (error, data) => (error ? fail(error) : done(data)))));

export async function makeFont({ fontnik, file, name, out, behind = null }) {
  const font = readFileSync(file);
  const dir = join(out, name);
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (let start = 0; start <= LAST; start += RANGE) {
    const own = await makeRange(fontnik, font, start, start + RANGE - 1);
    const fallback = behind && existsSync(join(behind, `${start}-${start + RANGE - 1}.pbf`)) ? readFileSync(join(behind, `${start}-${start + RANGE - 1}.pbf`)) : null;
    const data = fallback ? await mergeRange(fontnik, [own, fallback]) : own;
    writeFileSync(join(dir, `${start}-${start + RANGE - 1}.pbf`), data);
    bytes += data.length;
  }
  return bytes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const value = (flag) => process.argv[process.argv.indexOf(flag) + 1];
  const ttf = value('--ttf');
  const out = value('--out');
  const from = process.argv.includes('--fontnik') ? value('--fontnik') : process.cwd();
  if (!ttf || !out) {
    console.error('kullanım: node make-fonts.mjs --ttf <Inter ttf klasörü> --out <fonts-compact klasörü> [--noto <fonts-compact klasörü>] [--fontnik <fontnik kurulu klasör>]');
    process.exit(2);
  }
  const noto = process.argv.includes('--noto') ? resolve(value('--noto')) : null;
  const fontnik = createRequire(join(resolve(from), 'x.js'))('fontnik');
  for (const [weight, file] of Object.entries(FACES)) {
    const bytes = await makeFont({ fontnik, file: join(ttf, file), name: `Inter${weight}`, out, behind: noto ? join(noto, `NotoSans${weight === 'Bold' ? 'Medium' : weight}`) : null });
    console.log(`Inter${weight}: ${(bytes / 1e6).toFixed(2)} MB`);
  }
}
