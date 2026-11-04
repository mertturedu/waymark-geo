export type FileKind = 'address' | 'tiles' | 'route' | 'buildings' | 'places' | 'directory' | 'base';
export type Tier = 'full' | 'basic';
export type FileBlocks = { size: number; sha256: string[] };
export type EncodedFile = { codec: 'zstd'; path: string; size: number; sha256: string };
export const MLT_SUFFIX = '.mlt.pmtiles';
export type ManifestFile = { kind: FileKind; path: string; size: number; sha256: string; blocks?: FileBlocks; encoded?: EncodedFile };
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
export type Manifest = {
  format: 1;
  minSdk: string;
  osm: { file: string; time: string };
  tiles: { build: string; time: string };
  base: ManifestFile[];
  regions: ManifestRegion[];
};

const REGION_KINDS: readonly string[] = ['address', 'tiles', 'route', 'buildings', 'places', 'directory'];
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

function checkPath(path: string): void {
  if (path.startsWith('/') || /[\\%?#]/.test(path)) fail(`yol geçersiz: ${path}`);
  for (const piece of path.split('/')) if (piece === '' || piece === '.' || piece === '..') fail(`yol geçersiz: ${path}`);
}

function file(value: unknown, kinds: readonly string[], seen: Set<string>): ManifestFile {
  const row = object(value, 'dosya');
  const kind = text(row.kind, 'dosya türü');
  if (!kinds.includes(kind)) fail(`dosya türü geçersiz: ${kind}`);
  const path = text(row.path, 'dosya yolu');
  checkPath(path);
  if (seen.has(path)) fail(`yol iki kez: ${path}`);
  seen.add(path);
  const size = count(row.size, 'boyut');
  const parsed: ManifestFile = { kind: kind as FileKind, path, size, sha256: text(row.sha256, 'sha256', SHA) };
  if (row.blocks !== undefined) parsed.blocks = blocks(row.blocks, size);
  if (row.encoded !== undefined) parsed.encoded = encoded(row.encoded, path, seen);
  return parsed;
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
  if (root.format !== 1) fail('biçim sürümü desteklenmiyor');
  const osm = object(root.osm, 'osm');
  const tiles = object(root.tiles, 'tiles');
  const seen = new Set<string>();
  const base = list(root.base, 'base').map((f) => file(f, ['base'], seen));
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
    const files = list(row.files, 'dosyalar').map((f) => file(f, REGION_KINDS, seen));
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
    format: 1,
    minSdk: text(root.minSdk, 'minSdk', /^\d+\.\d+\.\d+$/),
    osm: { file: text(osm.file, 'osm dosyası'), time: text(osm.time, 'osm zamanı') },
    tiles: { build: text(tiles.build, 'karo derlemesi', /^\d{8}$/), time: text(tiles.time, 'karo zamanı') },
    base,
    regions,
  };
}
