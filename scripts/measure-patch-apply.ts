import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePatch, zstdPatchTool } from '../pipeline/build/patches';
import { readPatchIndex } from '../src/core/packs/patch';
import { parseManifest } from '../src/core/region/manifest';

const root = fileURLToPath(new URL('..', import.meta.url));
const argument = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`${name} gerekli`);
  return value;
};

const region = argument('--region');
const kind = argument('--kind');
const oldTag = argument('--old', '20261020.20261022');
const newTag = argument('--new', '20261028.20261030.3');
const maxSlices = Number(argument('--slices', '4'));
const work = argument('--work', join(tmpdir(), 'patch-apply-measure'));

const fileIn = (tag: string): string => {
  const manifest = parseManifest(readFileSync(join(root, 'dist', 'releases', tag, 'packs', 'manifest-v1.json'), 'utf8'));
  const found = manifest.regions.find((item) => item.id === region)?.files.find((item) => item.kind === kind);
  if (!found) throw new Error(`${tag}: ${region}/${kind} yok`);
  return join(root, 'dist', 'releases', tag, 'packs', found.path);
};

const older = readFileSync(fileIn(oldTag));
const newer = readFileSync(fileIn(newTag));
mkdirSync(work, { recursive: true });
const tmp = mkdtempSync(join(work, 'p-'));
const patch = (await encodePatch(older, newer, zstdPatchTool, tmp))!;
rmSync(tmp, { recursive: true, force: true });
const index = readPatchIndex(patch)!;
const used = index.slices.slice(0, maxSlices);
const low = Math.min(...used.map((slice) => slice.refStart));
const high = Math.max(...used.map((slice) => slice.refStart + slice.refLength));
const frames = patch.subarray(used[0]!.frameOffset, used[used.length - 1]!.frameOffset + used[used.length - 1]!.frameSize);

let produced = 0;
const slices = used.map((slice) => {
  const start = produced;
  produced += slice.length;
  const part = newer.subarray(start, start + slice.length);
  let h = 0x811c9dc5;
  for (const byte of part) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return { refStart: slice.refStart - low, refLength: slice.refLength, off: slice.frameOffset - used[0]!.frameOffset, frameSize: slice.frameSize, length: slice.length, fnv: h };
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
const baseline = process.argv.includes('--baseline');
const entry = `
import { decompressInPlaceSteps } from '${join(root, 'src', 'core', 'packs', 'fzstd.ts')}';
const SLICES = ${JSON.stringify(slices)};
const T='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';const map=new Uint8Array(128);for(let i=0;i<T.length;i++)map[T.charCodeAt(i)]=i;
function d64(B){const pad=B.endsWith('==')?2:B.endsWith('=')?1:0;const out=new Uint8Array(B.length/4*3-pad);for(let i=0,o=0;i<B.length;i+=4){const n=(map[B.charCodeAt(i)]<<18)|(map[B.charCodeAt(i+1)]<<12)|(map[B.charCodeAt(i+2)]<<6)|map[B.charCodeAt(i+3)];if(o<out.length)out[o++]=(n>>16)&255;if(o<out.length)out[o++]=(n>>8)&255;if(o<out.length)out[o++]=n&255;}return out;}
const OLD=d64('${b64(older.subarray(low, high))}'), PAT=d64('${b64(frames)}');
const live = () => typeof HermesInternal === 'object' ? (s => s.js_externalBytes + s.js_heapSize)(HermesInternal.getInstrumentedStats()) : 0;
const floor = live();
let total=0, decodeMs=0, worstStep=0, steps=0, ok=true, extra=0;
${baseline ? '' : `const work = new Uint8Array(Math.max(...SLICES.map(s => s.refLength + s.length)));
for (const s of SLICES) {
  work.set(OLD.subarray(s.refStart, s.refStart + s.refLength), 0);
  const frame = PAT.subarray(s.off, s.off + s.frameSize);
  const run = decompressInPlaceSteps(frame, work.subarray(0, s.refLength + s.length), s.refLength);
  let out;
  for (;;) {
    const t0 = Date.now();
    const next = run.next();
    const dt = Date.now() - t0;
    decodeMs += dt; steps++;
    if (dt > worstStep) worstStep = dt;
    const used = live() - floor;
    if (used > extra) extra = used;
    if (next.done) { out = next.value; break; }
  }
  total += out.length;
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < out.length; i++) h = Math.imul(h ^ out[i], 0x01000193) >>> 0;
  if (h !== s.fnv) ok = false;
}`}
const line = JSON.stringify({ engine: typeof HermesInternal === 'object' ? 'hermes' : 'node', name: '${region}/${kind}', baseline: ${baseline}, slices: SLICES.length, outMB: +(total/1e6).toFixed(1), decodeMs, MBs: decodeMs ? +(total/1e6/(decodeMs/1000)).toFixed(1) : 0, steps, worstStepMs: worstStep, extraMB: +(extra/1e6).toFixed(1), ok });
if (typeof print === 'function') print(line); else console.log(line);
`;
const entryPath = join(work, `${region}-${kind}-entry.mjs`);
const bundle = join(work, `${region}-${kind}${baseline ? '-base' : ''}.js`);
writeFileSync(entryPath, entry);
execFileSync(join(root, 'node_modules', '.bin', 'esbuild'), [entryPath, '--bundle', '--format=iife', '--target=es2019', `--outfile=${bundle}`, '--log-level=error']);
console.log(`yama ${(patch.length / 1e6).toFixed(1)} MB (tam ${(newer.length / 1e6).toFixed(1)} MB), ${index.slices.length} dilim, ölçülen ${slices.length}, sha256 yeni ${createHash('sha256').update(newer).digest('hex').slice(0, 12)}`);
if (!baseline) console.log(execFileSync('node', [bundle], { encoding: 'utf8' }).trim());
const hermes = join(root, 'pipeline', 'bin', 'hermes', 'hermes');
const run = spawnSync('/usr/bin/time', ['-l', hermes, '-O', bundle], { encoding: 'utf8', maxBuffer: 1 << 26 });
const resident = /(\d+)\s+maximum resident/.exec(run.stderr)?.[1];
console.log(`${run.stdout.trim()}${resident ? ` | tepe bellek ${(Number(resident) / 1e6).toFixed(0)} MB` : ''}`);
