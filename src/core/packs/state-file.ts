import type { FileKind } from '../region/manifest';
import type { FsPort } from './ports';

export type InstalledFile = { path: string; size: number; sha256: string };
export type PartKind = Extract<FileKind, 'address' | 'tiles' | 'buildings' | 'places' | 'directory' | 'route'>;
export type RegionRecord = { version: string; files: Partial<Record<PartKind, InstalledFile>> };
export type PackState = {
  v: 1;
  regions: Record<string, RegionRecord>;
  base: { build: string; files: InstalledFile[] } | null;
  pending: Record<string, { parts: PartKind[] }>;
  dismissed: string[];
  checked: { manifest: string; signature: string; keys: string[] } | null;
  checkedAt?: number;
};

export const STATE_PATH = 'state.json';
export const BACKUP_PATH = 'state.json.bak';
export const PART_KINDS: readonly PartKind[] = ['address', 'tiles', 'buildings', 'places', 'directory', 'route'];

const SHA = /^[0-9a-f]{64}$/;
const PLATE = /^\d{2}$/;

export const emptyState = (): PackState => ({ v: 1, regions: {}, base: null, pending: {}, dismissed: [], checked: null });

export const serializeState = (state: PackState): string => JSON.stringify(state);

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

function safePath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '' || path.startsWith('/') || /[\\%?#]/.test(path)) return false;
  return path.split('/').every((piece) => piece !== '' && piece !== '.' && piece !== '..');
}

function installedFile(value: unknown): InstalledFile | null {
  if (!isObject(value) || !safePath(value.path)) return null;
  const { size, sha256 } = value;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || typeof sha256 !== 'string' || !SHA.test(sha256)) return null;
  return { path: value.path, size, sha256 };
}

function partList(value: unknown): PartKind[] | null {
  if (!Array.isArray(value)) return null;
  const parts: PartKind[] = [];
  for (const item of value) {
    if (!PART_KINDS.includes(item as PartKind)) return null;
    parts.push(item as PartKind);
  }
  return parts;
}

export function parseState(text: string): PackState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.v !== 1 || !isObject(raw.regions) || !isObject(raw.pending) || !Array.isArray(raw.dismissed)) return null;
  const state = emptyState();
  for (const [id, record] of Object.entries(raw.regions)) {
    if (!PLATE.test(id) || !isObject(record) || typeof record.version !== 'string' || !isObject(record.files)) return null;
    const files: RegionRecord['files'] = {};
    for (const [kind, file] of Object.entries(record.files)) {
      const parsed = installedFile(file);
      if (!PART_KINDS.includes(kind as PartKind) || !parsed) return null;
      files[kind as PartKind] = parsed;
    }
    state.regions[id] = { version: record.version, files };
  }
  if (raw.base !== null) {
    if (!isObject(raw.base) || typeof raw.base.build !== 'string' || !Array.isArray(raw.base.files)) return null;
    const files = raw.base.files.map(installedFile);
    if (files.some((f) => f === null)) return null;
    state.base = { build: raw.base.build, files: files as InstalledFile[] };
  }
  for (const [id, job] of Object.entries(raw.pending)) {
    const parts = isObject(job) ? partList(job.parts) : null;
    if (!PLATE.test(id) || !parts) return null;
    state.pending[id] = { parts };
  }
  if (!raw.dismissed.every((id) => typeof id === 'string' && PLATE.test(id))) return null;
  state.dismissed = raw.dismissed as string[];
  if (raw.checked !== undefined && raw.checked !== null) {
    const { checked } = raw;
    if (!isObject(checked) || typeof checked.manifest !== 'string' || !SHA.test(checked.manifest) || typeof checked.signature !== 'string' || !SHA.test(checked.signature) || !Array.isArray(checked.keys) || !checked.keys.every((key) => typeof key === 'string')) return null;
    state.checked = { manifest: checked.manifest, signature: checked.signature, keys: checked.keys as string[] };
  }
  if (typeof raw.checkedAt === 'number' && Number.isFinite(raw.checkedAt) && raw.checkedAt >= 0) state.checkedAt = raw.checkedAt;
  return state;
}

export async function loadState(fs: FsPort): Promise<{ state: PackState; trusted: boolean }> {
  const main = await fs.readText(STATE_PATH);
  const backup = await fs.readText(BACKUP_PATH);
  if (main === null && backup === null) return { state: emptyState(), trusted: true };
  const fromMain = main === null ? null : parseState(main);
  if (fromMain) return { state: fromMain, trusted: true };
  const fromBackup = backup === null ? null : parseState(backup);
  if (fromBackup) return { state: fromBackup, trusted: true };
  return { state: emptyState(), trusted: false };
}

export async function saveState(fs: FsPort, state: PackState): Promise<void> {
  const current = await fs.readText(STATE_PATH);
  if (current !== null && parseState(current)) await fs.writeAtomic(BACKUP_PATH, current);
  await fs.writeAtomic(STATE_PATH, serializeState(state));
}
