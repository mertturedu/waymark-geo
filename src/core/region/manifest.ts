export type FileKind = 'address' | 'tiles' | 'route' | 'buildings' | 'buildings2' | 'places' | 'directory' | 'learned' | 'base';
export type Tier = 'full' | 'basic';
export type FileBlocks = { size: number; sha256: string[] };
export type EncodedFile = { codec: 'zstd'; path: string; size: number; sha256: string };
export const MLT_SUFFIX = '.mlt.pmtiles';
export type ManifestPatch = { from: string; codec: 'zstd-patch-seg'; path: string; size: number; sha256: string; blocks?: FileBlocks; segment: number; margin: number };
export type ManifestFile = { kind: FileKind; path: string; size: number; sha256: string; blocks?: FileBlocks; encoded?: EncodedFile; patches?: ManifestPatch[] };
export type Box = [number, number, number, number];
export type ManifestRegion = {
  id: string;
  tier: Tier;
  names: Record<string, string>;
  bbox: Box;
  version: string;
  stats: { addresses: number; streets: number; neighbourhoods: number };
  files: ManifestFile[];
};
export const MANIFEST_FORMATS: readonly (1 | 2)[] = [1, 2];

export type Manifest = {
  format: 1 | 2;
  minSdk: string;
  osm: { file: string; time: string };
  tiles: { build: string; time: string };
  base: ManifestFile[];
  regions: ManifestRegion[];
};

const REGION_KINDS: readonly string[] = ['address', 'tiles', 'route', 'buildings', 'buildings2', 'places', 'directory', 'learned'];
const KNOWN_KINDS: readonly string[] = [...REGION_KINDS, 'base'];
const SHA = /^[0-9a-f]{64}$/;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function serializeManifest(manifest: Manifest): string {
  return JSON.stringify(sorted(manifest), null, 2) + '\n';
}

const fail = (what: string): never => {
  throw new Error(`manifest: ${what}`);
};

function object(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${what} nesne olmalı`);
  return value as Record<string, unknown>;
}

function text(value: unknown, what: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value === '' || (pattern && !pattern.test(value))) fail(`${what} geçersiz`);
  return value as string;
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail(`${what} geçersiz`);
  return value as number;
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) fail(`${what} dizi olmalı`);
  return value as unknown[];
}

const badPath = (path: string): boolean => path.startsWith('/') || /[\\%?#]/.test(path) || path.split('/').some((piece) => piece === '' || piece === '.' || piece === '..');

function checkPath(path: string): void {
  if (badPath(path)) fail(`yol geçersiz: ${path}`);
}

function file(value: unknown, kinds: readonly string[], seen: Set<string>): ManifestFile | null {
  const row = object(value, 'dosya');
  const kind = text(row.kind, 'dosya türü');
  if (!KNOWN_KINDS.includes(kind)) return null;
  if (!kinds.includes(kind)) fail(`dosya türü geçersiz: ${kind}`);
  const path = text(row.path, 'dosya yolu');
  checkPath(path);
  if (seen.has(path)) fail(`yol iki kez: ${path}`);
  seen.add(path);
  const size = count(row.size, 'boyut');
  const parsed: ManifestFile = { kind: kind as FileKind, path, size, sha256: text(row.sha256, 'sha256', SHA) };
  if (row.blocks !== undefined) parsed.blocks = blocks(row.blocks, size);
  if (row.encoded !== undefined) parsed.encoded = encoded(row.encoded, path, seen);
  const patches = patchList(row.patches, parsed);
  if (patches.length > 0) parsed.patches = patches;
  return parsed;
}

const whole = (value: unknown, least: number): value is number => Number.isInteger(value) && (value as number) >= least;

const hash = (value: unknown): value is string => typeof value === 'string' && SHA.test(value);

function patch(value: unknown, owner: ManifestFile): ManifestPatch | null {
  if (!(value instanceof Object)) return null;
  const { from, codec, path, size, sha256, segment, margin } = value as Record<string, unknown>;
  if (codec !== 'zstd-patch-seg' || !hash(from) || from === owner.sha256 || !hash(sha256)) return null;
  if (typeof path !== 'string' || badPath(path) || path === owner.path || path === owner.encoded?.path) return null;
  if (!whole(size, 1) || !whole(segment, 1) || !whole(margin, 0)) return null;
  const given = (value as Record<string, unknown>).blocks;
  if (given === undefined) return { from, codec, path, size, sha256, segment, margin };
  const checked = patchBlocks(given, size);
  return checked === null ? null : { from, codec, path, size, sha256, blocks: checked, segment, margin };
}

function patchBlocks(value: unknown, fileSize: number): FileBlocks | null {
  if (!(value instanceof Object)) return null;
  const { size, sha256 } = value as Record<string, unknown>;
  if (!whole(size, 1) || !Array.isArray(sha256) || sha256.length !== Math.ceil(fileSize / size) || !sha256.every(hash)) return null;
  return { size, sha256: sha256 as string[] };
}

function patchList(value: unknown, owner: ManifestFile): ManifestPatch[] {
  if (!Array.isArray(value)) return [];
  const out: ManifestPatch[] = [];
  for (const item of value) {
    const parsed = patch(item, owner);
    if (parsed && !out.some((kept) => kept.from === parsed.from || kept.path === parsed.path)) out.push(parsed);
  }
  return out;
}

function encoded(value: unknown, plainPath: string, seen: Set<string>): EncodedFile {
  const row = object(value, 'sıkıştırılmış dosya');
  if (row.codec !== 'zstd') fail('sıkıştırma türü desteklenmiyor');
  const path = text(row.path, 'sıkıştırılmış dosya yolu');
  checkPath(path);
  if (path === plainPath || seen.has(path)) fail(`yol iki kez: ${path}`);
  seen.add(path);
  const size = count(row.size, 'sıkıştırılmış boyut');
  if (size === 0) fail('sıkıştırılmış boyut sıfır');
  return { codec: 'zstd', path, size, sha256: text(row.sha256, 'sıkıştırılmış sha256', SHA) };
}

function blocks(value: unknown, fileSize: number): FileBlocks {
  const row = object(value, 'bloklar');
  const size = count(row.size, 'blok boyutu');
  if (size === 0) fail('blok boyutu sıfır');
  const hashes = list(row.sha256, 'blok özetleri').map((h) => text(h, 'blok sha256', SHA));
  if (hashes.length !== Math.ceil(fileSize / size)) fail('blok sayısı dosya boyutuyla uyuşmuyor');
  return { size, sha256: hashes };
}

function box(value: unknown): Box {
  const numbers = list(value, 'bbox');
  if (numbers.length !== 4 || numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) fail('bbox geçersiz');
  const [west, south, east, north] = numbers as number[];
  if ((west as number) >= (east as number) || (south as number) >= (north as number)) fail('bbox ters');
  return [west, south, east, north] as Box;
}

export function parseManifest(source: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return fail('JSON okunamadı');
  }
  const root = object(raw, 'kök');
  if (root.format !== 1 && root.format !== 2) fail('biçim sürümü desteklenmiyor');
  const osm = object(root.osm, 'osm');
  const tiles = object(root.tiles, 'tiles');
  const seen = new Set<string>();
  const present = <T>(item: T | null): item is T => item !== null;
  const base = list(root.base, 'base').map((f) => file(f, ['base'], seen)).filter(present);
  const ids = new Set<string>();
  const regions = list(root.regions, 'regions').map((value): ManifestRegion => {
    const row = object(value, 'bölge');
    const id = text(row.id, 'bölge kimliği', /^\d{2}$/);
    if (ids.has(id)) fail(`bölge iki kez: ${id}`);
    ids.add(id);
    const tier = row.tier;
    if (tier !== 'full' && tier !== 'basic') fail('katman geçersiz');
    const names = object(row.names, 'adlar');
    for (const [lang, name] of Object.entries(names)) text(name, `ad ${lang}`);
    if (!('tr' in names)) fail('Türkçe ad yok');
    const stats = object(row.stats, 'sayılar');
    const files = list(row.files, 'dosyalar').map((f) => file(f, REGION_KINDS, seen)).filter(present);
    if (tier === 'basic' && files.some((f) => f.kind === 'buildings')) fail(`basic bölgede buildings dosyası olamaz: ${id}`);
    return {
      id,
      tier: tier as Tier,
      names: names as Record<string, string>,
      bbox: box(row.bbox),
      version: text(row.version, 'sürüm'),
      stats: { addresses: count(stats.addresses, 'adres sayısı'), streets: count(stats.streets, 'sokak sayısı'), neighbourhoods: count(stats.neighbourhoods, 'mahalle sayısı') },
      files,
    };
  });
  return {
    format: root.format as 1 | 2,
    minSdk: text(root.minSdk, 'minSdk', /^\d+\.\d+\.\d+$/),
    osm: { file: text(osm.file, 'osm dosyası'), time: text(osm.time, 'osm zamanı') },
    tiles: { build: text(tiles.build, 'karo derlemesi', /^\d{8}$/), time: text(tiles.time, 'karo zamanı') },
    base,
    regions,
  };
}
