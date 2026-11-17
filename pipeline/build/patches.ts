import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join } from 'node:path';
import { buildPatch, readPatchIndex, type PatchPart } from '../../src/core/packs/patch';
import { parseManifest, type Manifest, type ManifestPatch } from '../../src/core/region/manifest';
import { blocksOf } from './blocks';

export const PATCH_SEGMENT = 8 * 1024 * 1024;
export const PATCH_MARGIN = 4 * 1024 * 1024;
export const PATCH_KEEP_BELOW = 0.85;
export const PATCH_MIN_SIZE = 1024 * 1024;
export const PATCH_KEEP_VERSIONS = 3;
const ZSTD_LEVEL = 19;
const WINDOW_LOG = 26;

export type PatchTool = {
  compress(reference: string | null, input: string, output: string): Promise<boolean>;
  decompress(reference: string | null, input: string, output: string): Promise<boolean>;
};

const zstd = (args: string[]): Promise<boolean> => new Promise((resolve) => execFile('zstd', args, (error) => resolve(error === null)));

export const zstdPatchTool: PatchTool = {
  compress: (reference, input, output) => zstd([`-${ZSTD_LEVEL}`, '-T1', '-q', '-f', `--long=${WINDOW_LOG}`, ...(reference ? [`--patch-from=${reference}`] : []), input, '-o', output]),
  decompress: (reference, input, output) => zstd(['-d', '-q', '-f', `--long=${WINDOW_LOG}`, ...(reference ? [`--patch-from=${reference}`] : []), input, '-o', output]),
};

export type PatchShape = { segment: number; margin: number };
const DEFAULT_SHAPE: PatchShape = { segment: PATCH_SEGMENT, margin: PATCH_MARGIN };

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function candidates(start: number, oldSize: number, newSize: number, shape: PatchShape): { start: number; length: number }[] {
  const fixed = clamp(start - shape.margin, 0, oldSize);
  const scaledAt = Math.round((start * oldSize) / newSize);
  const scaled = clamp(scaledAt - shape.margin, 0, oldSize);
  const span = shape.segment + 2 * shape.margin;
  const options = [
    { start: fixed, length: clamp(start + shape.segment + shape.margin, 0, oldSize) - fixed },
    { start: scaled, length: clamp(scaledAt + shape.segment + shape.margin, 0, oldSize) - scaled },
  ].map((item) => ({ start: item.start, length: Math.min(item.length, span) }));
  return options.filter((item, i) => options.findIndex((other) => other.start === item.start && other.length === item.length) === i);
}

export async function encodePatch(older: Buffer, newer: Buffer, tool: PatchTool, tmp: string, shape: PatchShape = DEFAULT_SHAPE): Promise<Uint8Array | null> {
  if (older.length === 0 || newer.length === 0) return null;
  const parts: PatchPart[] = [];
  const reference = join(tmp, 'ref');
  const input = join(tmp, 'in');
  const output = join(tmp, 'out');
  for (let start = 0; start < newer.length; start += shape.segment) {
    const slice = newer.subarray(start, Math.min(newer.length, start + shape.segment));
    writeFileSync(input, slice);
    let best: PatchPart | null = null;
    for (const option of candidates(start, older.length, newer.length, shape)) {
      if (option.length > 0) writeFileSync(reference, older.subarray(option.start, option.start + option.length));
      if (!(await tool.compress(option.length > 0 ? reference : null, input, output))) return null;
      const frame = new Uint8Array(readFileSync(output));
      if (best === null || frame.length < best.frame.length) best = { length: slice.length, refStart: option.start, refLength: option.length, frame };
    }
    if (best === null) return null;
    parts.push(best);
  }
  return buildPatch(newer.length, older.length, parts);
}

export async function applyPatch(older: Buffer, patch: Uint8Array, tool: PatchTool, tmp: string): Promise<Buffer | null> {
  const index = readPatchIndex(patch);
  if (index === null || index.oldSize !== older.length) return null;
  const reference = join(tmp, 'ref');
  const input = join(tmp, 'in');
  const output = join(tmp, 'out');
  const pieces: Buffer[] = [];
  for (const slice of index.slices) {
    if (slice.refLength > 0) writeFileSync(reference, older.subarray(slice.refStart, slice.refStart + slice.refLength));
    writeFileSync(input, patch.subarray(slice.frameOffset, slice.frameOffset + slice.frameSize));
    if (!(await tool.decompress(slice.refLength > 0 ? reference : null, input, output))) return null;
    const piece = readFileSync(output);
    if (piece.length !== slice.length) return null;
    pieces.push(piece);
  }
  return Buffer.concat(pieces);
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part));
  const right = b.split('.').map((part) => Number(part));
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type Archived = { version: string; dir: string; manifest: Manifest };

function readManifest(dir: string): Manifest | null {
  try {
    return parseManifest(readFileSync(join(dir, 'manifest-v1.json'), 'utf8'));
  } catch {
    return null;
  }
}

export const versionOf = (manifest: Manifest): string | null => manifest.regions[0]?.version ?? null;

function link(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  try {
    linkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

export function archivePack(packs: string, archiveDir: string): string | null {
  const manifest = readManifest(packs);
  const version = manifest ? versionOf(manifest) : null;
  if (manifest === null || version === null) return null;
  const target = join(archiveDir, version);
  if (existsSync(target)) return version;
  const staging = `${target}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  link(join(packs, 'manifest-v1.json'), join(staging, 'manifest-v1.json'));
  for (const region of manifest.regions) for (const file of region.files) if (existsSync(join(packs, file.path))) link(join(packs, file.path), join(staging, file.path));
  renameSync(staging, target);
  return version;
}

export function listArchive(archiveDir: string, exclude?: string): Archived[] {
  if (!existsSync(archiveDir)) return [];
  const found: Archived[] = [];
  for (const name of readdirSync(archiveDir)) {
    if (name.endsWith('.tmp') || name === exclude) continue;
    const manifest = readManifest(join(archiveDir, name));
    if (manifest) found.push({ version: name, dir: join(archiveDir, name), manifest });
  }
  return found.sort((a, b) => compareVersions(b.version, a.version));
}

export function pruneArchive(archiveDir: string, keep: number, exclude?: string): string[] {
  const dropped = listArchive(archiveDir, exclude).slice(keep);
  for (const old of dropped) rmSync(old.dir, { recursive: true, force: true });
  return dropped.map((old) => old.version);
}

export type PatchFile = { regionId: string; kind: string; path: string; size: number; sha256: string; download: number; source: string };

export type PatchStats = { made: number; cached: number; tooBig: number; unverified: number; skippedSmall: number; bytes: number; ms: number };

export type PatchOptions = { outDir: string; archiveDir: string; cacheDir: string; tmpDir: string; keep?: number; tool?: PatchTool; shape?: PatchShape; concurrency?: number; exclude?: string; log?: (line: string) => void };

type Job = { file: PatchFile; from: Archived; old: string; oldSha: string };

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
}

export async function makePatches(files: PatchFile[], options: PatchOptions): Promise<{ patches: Map<string, ManifestPatch[]>; stats: PatchStats }> {
  const started = Date.now();
  const tool = options.tool ?? zstdPatchTool;
  const shape = options.shape ?? DEFAULT_SHAPE;
  const stats: PatchStats = { made: 0, cached: 0, tooBig: 0, unverified: 0, skippedSmall: 0, bytes: 0, ms: 0 };
  const versions = listArchive(options.archiveDir, options.exclude).slice(0, options.keep ?? PATCH_KEEP_VERSIONS);
  const jobs: Job[] = [];
  for (const file of files) {
    if (file.size < PATCH_MIN_SIZE) {
      stats.skippedSmall += 1;
      continue;
    }
    const seen = new Set<string>([file.sha256]);
    for (const from of versions) {
      const before = from.manifest.regions.find((region) => region.id === file.regionId)?.files.find((item) => item.kind === file.kind);
      if (!before || seen.has(before.sha256) || !existsSync(join(from.dir, before.path))) continue;
      seen.add(before.sha256);
      jobs.push({ file, from, old: join(from.dir, before.path), oldSha: before.sha256 });
    }
  }
  const result = new Map<string, ManifestPatch[]>();
  mkdirSync(options.cacheDir, { recursive: true });
  mkdirSync(options.tmpDir, { recursive: true });
  const lanes = options.concurrency ?? Math.max(1, Math.min(cpus().length - 2, 6));
  await pool(jobs, lanes, async (job) => {
    const name = `${job.file.kind}-${job.file.sha256.slice(0, 8)}-from-${job.oldSha.slice(0, 8)}.zpatch`;
    const path = `${job.file.regionId}/patches/${name}`;
    const key = createHash('sha256').update(`${job.oldSha}:${job.file.sha256}:${shape.segment}:${shape.margin}:${ZSTD_LEVEL}:${WINDOW_LOG}`).digest('hex');
    const cached = join(options.cacheDir, `${key}.zpatch`);
    const refused = join(options.cacheDir, `${key}.none`);
    let bytes: Uint8Array | null = null;
    if (existsSync(refused)) {
      stats.tooBig += 1;
      return;
    }
    if (existsSync(cached)) {
      bytes = new Uint8Array(readFileSync(cached));
      stats.cached += 1;
    } else {
      const tmp = mkdtempSync(join(options.tmpDir, 'p-'));
      try {
        const older = readFileSync(job.old);
        const newer = readFileSync(job.file.source);
        const made = await encodePatch(older, newer, tool, tmp, shape);
        const rebuilt = made === null ? null : await applyPatch(older, made, tool, tmp);
        if (made === null || rebuilt === null || sha256(rebuilt) !== job.file.sha256) {
          stats.unverified += 1;
          options.log?.(`yama ${path}: geri uygulanınca tutmadı, atlandı`);
          return;
        }
        if (made.length > job.file.download * PATCH_KEEP_BELOW) {
          writeFileSync(refused, String(made.length));
          stats.tooBig += 1;
          return;
        }
        writeFileSync(`${cached}.tmp`, made);
        renameSync(`${cached}.tmp`, cached);
        bytes = made;
        stats.made += 1;
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    }
    if (bytes === null || bytes.length > job.file.download * PATCH_KEEP_BELOW) {
      stats.tooBig += 1;
      return;
    }
    const target = join(options.outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    link(cached, target);
    stats.bytes += bytes.length;
    const list = result.get(job.file.path) ?? [];
    const blocks = blocksOf(target);
    list.push({ from: job.oldSha, codec: 'zstd-patch-seg', path, size: bytes.length, sha256: sha256(bytes), ...(blocks ? { blocks } : {}), segment: shape.segment, margin: shape.margin });
    result.set(job.file.path, list);
  });
  for (const list of result.values()) list.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  stats.ms = Date.now() - started;
  return { patches: result, stats };
}

export const patchKeep = (): number => {
  const text = process.env.GEO_PATCHES;
  if (text === undefined || text === '') return PATCH_KEEP_VERSIONS;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 ? value : PATCH_KEEP_VERSIONS;
};
