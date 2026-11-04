import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { openPmtiles } from '../pipeline/build/pmtiles-file';
import { defaultRunner, type Runner } from '../pipeline/build/tiles';
import { MLT_SUFFIX } from '../src/core/region/manifest';

const root = fileURLToPath(new URL('..', import.meta.url));
export const LOCK_FILE = join(root, 'pipeline', 'mlt-native.lock.json');
export const TOOL_DIR = join(root, 'pipeline', 'tools', 'mlt-native-check');
export const SOURCE_DIR = join(root, 'pipeline', 'data', 'mlt-native');
export const CHECKER = join(root, 'pipeline', 'bin', 'mlt-native-check');
const DECODER_SOURCES = ['decoder.cpp', 'decode/int.cpp', 'feature.cpp', 'geometry_vector.cpp', 'layer.cpp', 'metadata/stream.cpp', 'metadata/tileset.cpp', 'properties.cpp', 'util/rle.cpp'];

export type Lock = { repo: string; commit: string; files: Record<string, string> };
export type CheckResult = { archive: string; ok: number; fail: number; first: string | null };
export type Fetch = (url: string) => Promise<Uint8Array>;

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const readLock = (): Lock => JSON.parse(readFileSync(LOCK_FILE, 'utf8')) as Lock;

const download: Fetch = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

export async function fetchSources(lock: Lock, dir: string, get: Fetch = download): Promise<number> {
  let fetched = 0;
  for (const [path, hash] of Object.entries(lock.files)) {
    const target = join(dir, lock.commit, path);
    if (existsSync(target) && sha256(readFileSync(target)) === hash) continue;
    const bytes = await get(`https://raw.githubusercontent.com/${lock.repo}/${lock.commit}/${path}`);
    if (sha256(bytes) !== hash) throw new Error(`${path}: sha256 kilit dosyasıyla uyuşmuyor`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    fetched += 1;
  }
  return fetched;
}

export function compileArgs(lock: Lock, dir: string, output: string): string[] {
  const base = join(dir, lock.commit, 'cpp');
  return ['-std=c++20', '-O1', '-DMLT_WITH_JSON=0', '-Wno-everything', `-I${join(TOOL_DIR, 'stubs')}`, `-I${join(base, 'include')}`, `-I${join(base, 'src')}`, join(TOOL_DIR, 'check.cpp'), ...DECODER_SOURCES.map((name) => join(base, 'src', 'mlt', name)), '-o', output];
}

export const checkerKey = (lock: Lock): string => createHash('sha256').update(JSON.stringify(lock)).update(readFileSync(join(TOOL_DIR, 'check.cpp'))).update(readFileSync(join(TOOL_DIR, 'stubs', 'fastpfor', 'fastpfor.h'))).digest('hex').slice(0, 16);

export async function ensureChecker(options: { get?: Fetch; run?: Runner; log?: (line: string) => void } = {}): Promise<string> {
  const lock = readLock();
  const marker = `${CHECKER}.key`;
  const key = checkerKey(lock);
  if (existsSync(CHECKER) && existsSync(marker) && readFileSync(marker, 'utf8') === key) return CHECKER;
  const fetched = await fetchSources(lock, SOURCE_DIR, options.get);
  options.log?.(`çözücü kaynakları: ${fetched} dosya indirildi (${lock.commit.slice(0, 8)})`);
  mkdirSync(dirname(CHECKER), { recursive: true });
  const run = options.run ?? defaultRunner;
  const { code, out } = await run(process.env.CXX ?? 'clang++', compileArgs(lock, SOURCE_DIR, CHECKER));
  if (code !== 0) throw new Error(`çözücü derlenemedi: ${out.slice(-600)}`);
  writeFileSync(marker, key);
  return CHECKER;
}

export function tilePack(archive: string, output: string): number {
  const source = openPmtiles(archive);
  const fd = openSync(output, 'w');
  let count = 0;
  try {
    for (const entry of source.entries) {
      const bytes = source.read(entry);
      const raw = source.header.tileCompression === 2 ? gunzipSync(bytes) : bytes;
      const head = Buffer.alloc(12);
      head.writeBigUInt64LE(BigInt(entry.tileId), 0);
      head.writeUInt32LE(raw.length, 8);
      writeSync(fd, head);
      writeSync(fd, raw);
      count += 1;
    }
  } finally {
    closeSync(fd);
    source.close();
  }
  return count;
}

export function parseCheck(archive: string, output: string): CheckResult {
  const summary = /ok=(\d+) fail=(\d+)\s*$/.exec(output.trim());
  if (!summary) throw new Error(`${archive}: çözücü çıktısı okunamadı: ${output.slice(-200)}`);
  return { archive, ok: Number(summary[1]), fail: Number(summary[2]), first: output.split('\n').find((line) => line.startsWith('FAIL')) ?? null };
}

export async function checkArchive(archive: string, run: Runner = defaultRunner): Promise<CheckResult> {
  const pack = join(tmpdir(), `mlt-native-${process.pid}-${createHash('sha256').update(archive).digest('hex').slice(0, 8)}.pack`);
  tilePack(archive, pack);
  try {
    const { out } = await run(CHECKER, [pack]);
    return parseCheck(archive, out);
  } finally {
    rmSync(pack, { force: true });
  }
}

export function mltArchives(packs: string): string[] {
  const manifest = JSON.parse(readFileSync(join(packs, 'manifest-v1.json'), 'utf8')) as { regions: { files: { path: string }[] }[] };
  return manifest.regions.flatMap((region) => region.files.filter((file) => file.path.endsWith(MLT_SUFFIX)).map((file) => join(packs, file.path)));
}

export async function main(targets: string[], log: (line: string) => void = console.log): Promise<number> {
  if (targets.length === 0) throw new Error('kullanım: check-mlt-native <paket klasörü | .mlt.pmtiles dosyaları...>');
  const archives = targets.flatMap((target) => (existsSync(join(target, 'manifest-v1.json')) ? mltArchives(target) : [target]));
  if (archives.length === 0) throw new Error('MLT karo dosyası bulunamadı');
  await ensureChecker({ log });
  let ok = 0;
  let fail = 0;
  for (const archive of archives) {
    const result = await checkArchive(archive);
    ok += result.ok;
    fail += result.fail;
    if (result.fail > 0) log(`BAŞARISIZ ${archive}: ${result.fail} karo (${result.first})`);
  }
  log(`${archives.length} dosya: ${ok} karo çözüldü, ${fail} çözülemedi`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    },
  );
}
