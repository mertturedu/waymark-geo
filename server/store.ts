import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { PackStore, SqlDb } from '../src/core/ports';
import { parseManifest, type Manifest, type ManifestFile } from '../src/core/region/manifest';
import { openSqlite } from '../src/node/sqlite';

export type PartKind = 'address' | 'buildings' | 'directory' | 'buildings2' | 'learned';

export type ServerStore = PackStore & { readonly manifest: Manifest; handles(): number; closeAll(): Promise<void>; refresh(): boolean; onChange(listener: (regions: string[]) => void): () => void; learnedAt(): string | null };

export const CLOSE_GRACE_MS = 30_000;
export const REFRESH_EVERY_MS = 2_000;

function manifestFile(dir: string): string {
  for (const name of ['manifest-v2.json', 'manifest-v1.json']) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  throw new Error(`${dir} içinde manifest yok`);
}

const readManifest = (dir: string): Manifest => parseManifest(readFileSync(manifestFile(dir), 'utf8'));

export function unpack(dir: string, entry: ManifestFile): string | null {
  const plain = join(dir, entry.path);
  if (existsSync(plain)) return plain;
  if (!entry.encoded || entry.encoded.codec !== 'zstd') return null;
  const packed = join(dir, entry.encoded.path);
  if (!existsSync(packed)) return null;
  const bytes = zstdDecompressSync(readFileSync(packed));
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`${entry.path} açılınca özet tutmuyor`);
  const temp = `${plain}.${process.pid}.part`;
  writeFileSync(temp, bytes);
  renameSync(temp, plain);
  return plain;
}

export function createServerStore(dir: string, graceMs = CLOSE_GRACE_MS, now: () => number = Date.now): ServerStore {
  let manifest = readManifest(dir);
  let stamp = statSync(manifestFile(dir)).mtimeMs;
  let checked = now();
  const listeners = new Set<(regions: string[]) => void>();
  const fileOf = (region: string, kind: PartKind): ManifestFile | undefined => manifest.regions.find((r) => r.id === region)?.files.find((f) => f.kind === kind);
  const handles = new Map<string, Promise<SqlDb | null>>();
  const closing = new Map<string, ReturnType<typeof setTimeout>>();
  const present = (f: ManifestFile): boolean => existsSync(join(dir, f.path)) || (f.encoded !== undefined && existsSync(join(dir, f.encoded.path)));

  const retire = (key: string): void => {
    if (closing.has(key)) return;
    closing.set(
      key,
      setTimeout(() => {
        closing.delete(key);
        const pending = handles.get(key);
        handles.delete(key);
        void pending?.then((db) => db?.close()).catch(() => undefined);
      }, graceMs),
    );
  };

  const refresh = (): boolean => {
    checked = now();
    let next: Manifest;
    let changedAt: number;
    try {
      const file = manifestFile(dir);
      changedAt = statSync(file).mtimeMs;
      if (changedAt === stamp) return false;
      next = parseManifest(readFileSync(file, 'utf8'));
    } catch {
      return false;
    }
    const before = manifest;
    manifest = next;
    stamp = changedAt;
    const changed = new Set<string>();
    for (const region of next.regions) {
      for (const f of region.files) {
        const old = before.regions.find((r) => r.id === region.id)?.files.find((x) => x.kind === f.kind);
        if (old?.sha256 !== f.sha256) changed.add(region.id);
      }
    }
    for (const region of changed) {
      for (const key of [...handles.keys()]) {
        if (!key.startsWith(`${region}/`)) continue;
        const old = handles.get(key);
        handles.delete(key);
        closing.delete(key);
        setTimeout(() => void old?.then((db) => db?.close()).catch(() => undefined), graceMs);
      }
    }
    for (const listener of [...listeners]) listener([...changed]);
    return true;
  };

  const due = (): void => {
    if (now() - checked >= REFRESH_EVERY_MS) refresh();
  };

  const open = (region: string, kind: PartKind): Promise<SqlDb | null> => {
    due();
    const key = `${region}/${kind}`;
    const timer = closing.get(key);
    if (timer) {
      clearTimeout(timer);
      closing.delete(key);
    }
    let pending = handles.get(key);
    if (!pending) {
      const entry = fileOf(region, kind);
      pending = Promise.resolve().then(() => {
        const file = entry ? unpack(dir, entry) : null;
        return file ? openSqlite(file) : null;
      });
      handles.set(key, pending);
      void pending.catch(() => handles.delete(key));
    }
    return pending;
  };

  return {
    get manifest() {
      return manifest;
    },
    refresh,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    learnedAt() {
      let latest = 0;
      for (const region of manifest.regions) {
        const f = region.files.find((x) => x.kind === 'learned');
        const path = f ? join(dir, f.path) : null;
        if (path && existsSync(path)) latest = Math.max(latest, statSync(path).mtimeMs);
      }
      return latest === 0 ? null : new Date(latest).toISOString();
    },
    async installed() {
      due();
      return manifest.regions.filter((r) => r.files.some((f) => f.kind === 'address' && present(f))).map((r) => r.id);
    },
    open: (region) => open(region, 'address'),
    openPart: (region, kind) => open(region, kind),
    release(region) {
      for (const key of [...handles.keys()]) if (key.startsWith(`${region}/`)) retire(key);
    },
    async closeAll() {
      for (const timer of closing.values()) clearTimeout(timer);
      closing.clear();
      const all = [...handles.values()];
      handles.clear();
      for (const pending of all) await (await pending.catch(() => null))?.close();
    },
    handles: () => handles.size,
  };
}
