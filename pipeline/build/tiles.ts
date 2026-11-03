import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetList } from '../../scripts/make-test-data';

export type Runner = (cmd: string, args: string[], timeoutMs?: number) => Promise<{ code: number; out: string }>;
export type Bounds = [number, number, number, number];

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const pmtilesBin = join(repoRoot, 'pipeline', 'bin', 'pmtiles');
const OVERVIEW_BBOX = '25.5,35.7,45,42.3';

export const defaultRunner: Runner = (cmd, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args);
    let out = '';
    let timedOut = false;
    const timer = timeoutMs === undefined ? null : setTimeout(() => ((timedOut = true), child.kill('SIGKILL')), timeoutMs);
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, out: String(error) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve(timedOut ? { code: 124, out: `zaman aşımı (${timeoutMs} ms)\n${out.slice(-300)}` } : { code: code ?? 1, out });
    });
  });

const EXTRACT_TIMEOUT_MS = 6 * 60_000;
const DRY_RUN_TIMEOUT_MS = 2 * 60_000;

export const sourceUrl = (build: string): string => `https://build.protomaps.com/${build}.pmtiles`;

export function extractArgs(source: string, out: string, geojson: string): string[] {
  return ['extract', source, out, `--region=${geojson}`, '--maxzoom=15'];
}

export function parseArchiveMb(out: string): number | null {
  const size = /for an archive size of ([\d.]+) MB/.exec(out);
  return size ? Number(size[1]) : null;
}

export function parseBounds(show: string): Bounds | null {
  const match = /bounds: \(long: (-?[\d.]+), lat: (-?[\d.]+)\) \(long: (-?[\d.]+), lat: (-?[\d.]+)\)/.exec(show);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}

async function checked(run: Runner, args: string[], what: string, timeoutMs?: number): Promise<string> {
  const { code, out } = await run(pmtilesBin, args, timeoutMs);
  if (code !== 0) throw new Error(`${what} başarısız: ${out.slice(-300)}`);
  return out;
}

async function describe(run: Runner, file: string): Promise<{ bytes: number; bounds: Bounds }> {
  const bounds = parseBounds(await checked(run, ['show', file], 'pmtiles show'));
  if (!bounds) throw new Error(`${file}: başlıktaki bounds okunamadı`);
  return { bytes: statSync(file).size, bounds };
}

const ATTEMPTS = 3;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetries<T>(task: () => Promise<T>, pauseMs: number, cleanup?: () => void): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      cleanup?.();
      if (attempt >= ATTEMPTS) throw error;
      await sleep(pauseMs * attempt);
    }
  }
}

export async function extractProvinceTiles(input: { plate: string; build: string; geojson: string; outFile: string; budgetMb: number; run?: Runner; pauseMs?: number }): Promise<{ bytes: number; bounds: Bounds }> {
  const run = input.run ?? defaultRunner;
  const pause = input.pauseMs ?? 3000;
  if (existsSync(input.outFile)) return describe(run, input.outFile);
  const temporary = `${input.outFile}.tmp`;
  rmSync(temporary, { force: true });
  mkdirSync(dirname(input.outFile), { recursive: true });
  const args = extractArgs(sourceUrl(input.build), temporary, input.geojson);
  const sized = parseArchiveMb(await withRetries(() => checked(run, [...args, '--dry-run'], 'pmtiles extract --dry-run', DRY_RUN_TIMEOUT_MS), pause));
  if (sized === null) throw new Error(`${input.plate}: dry run boyutu okunamadı`);
  if (sized > input.budgetMb) throw new Error(`${input.plate}: ${sized} MB, bütçe ${input.budgetMb} MB`);
  try {
    await withRetries(() => checked(run, args, `${input.plate} pmtiles extract`, EXTRACT_TIMEOUT_MS), pause, () => rmSync(temporary, { force: true }));
    await checked(run, ['verify', temporary], `${input.plate} pmtiles verify`);
    renameSync(temporary, input.outFile);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  return describe(run, input.outFile);
}

export function baseAssets(): { url: string; path: string }[] {
  return assetList()
    .filter((asset) => asset.path.startsWith('fonts-compact/') || asset.path.startsWith('sprites/'))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function fetchTo(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.tmp`, Buffer.from(await response.arrayBuffer()));
  renameSync(`${target}.tmp`, target);
}

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')]));
}

export const INTER_DIR = fileURLToPath(new URL('../data/fonts-inter', import.meta.url));

function addInter(source: string, outDir: string): void {
  if (!existsSync(source)) return;
  for (const face of readdirSync(source)) {
    const target = join(outDir, 'fonts-compact', face);
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(join(source, face))) if (!existsSync(join(target, file))) copyFileSync(join(source, face, file), join(target, file));
  }
}

export async function buildBasePack(input: { build: string; outDir: string; run?: Runner; download?: (url: string, target: string) => Promise<void>; interDir?: string }): Promise<string[]> {
  const run = input.run ?? defaultRunner;
  const download = input.download ?? fetchTo;
  mkdirSync(input.outDir, { recursive: true });
  const overview = join(input.outDir, 'overview.pmtiles');
  if (!existsSync(overview)) {
    const temporary = `${overview}.tmp`;
    rmSync(temporary, { force: true });
    const args = ['extract', sourceUrl(input.build), temporary, `--bbox=${OVERVIEW_BBOX}`, '--maxzoom=8'];
    try {
      await checked(run, args, 'genel harita extract', EXTRACT_TIMEOUT_MS);
      await checked(run, ['verify', temporary], 'genel harita verify');
      renameSync(temporary, overview);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  for (const asset of baseAssets()) {
    const target = join(input.outDir, asset.path);
    if (!existsSync(target)) await download(asset.url, target);
  }
  if (input.interDir) addInter(input.interDir, input.outDir);
  return listFiles(input.outDir).filter((path) => !path.endsWith('.tmp')).sort();
}

export const PRIORITY_PLATES = ['16', '10', '35', '38', '20', '42', '06', '34', '58', '45', '41', '59'];

export async function buildProvinceTiles(input: { regionsDir: string; outDir: string; build: string; plates: string[]; budgets: Record<string, number>; run?: Runner; log?: (line: string) => void }): Promise<Record<string, { bytes: number; bounds: Bounds }>> {
  const done: Record<string, { bytes: number; bounds: Bounds }> = {};
  for (const plate of input.plates) {
    const geojson = join(input.regionsDir, `${plate}.geojson`);
    if (!existsSync(geojson)) throw new Error(`${plate}: bölge dosyası yok (${geojson})`);
    done[plate] = await extractProvinceTiles({ plate, build: input.build, geojson, outFile: join(input.outDir, `${plate}.pmtiles`), budgetMb: input.budgets[plate] ?? Infinity, run: input.run });
    input.log?.(`${plate} ${(done[plate].bytes / 1e6).toFixed(1)} MB`);
  }
  return done;
}
