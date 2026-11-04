import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { upperTr } from '../../src/core/text/upper';
import { decodeLayer, decodeTile, decodeValue, encodeLayer, encodeTile, featureId, featureProperties, pruneLayer } from './mvt';
import { gzipStable, openPmtiles, writePmtiles, zoomOfTileId } from './pmtiles-file';
import { drawnAt, keepsKey, NAME_LIKE, styleVariants, usageProfile, type DrawFeature, type SourceKind, type UsageProfile } from './tile-usage';

export type PruneStats = { tiles: number; contents: number; bytesIn: number; bytesOut: number; features: number; dropped: number; layersDropped: number; untouched: number };
export type GlyphStats = { files: number; stubs: number; bytesIn: number; bytesOut: number };
export type PruneReport = { profile: string; ranges: number; files: Record<string, PruneStats>; glyphs: GlyphStats };

const MVT = 1;
const RAW = 1;
const GZIP = 2;
const span = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const KEPT_RANGES: number[] = [...span(0x00, 0x06), ...span(0x1e, 0x2b), 0xfb, 0xfe, 0xff];
export const PRUNE_MARK = 'yuksi:prune';

function labelKeys(profile: UsageProfile, kind: SourceKind, layer: string): (key: string) => boolean {
  const named = profile.named.has(`${kind}/${layer}`);
  return (key) => profile.labels.has(key) || (named && NAME_LIKE.test(key));
}

export function pruneTileArchive(input: { source: string; target: string; kind: SourceKind; profile: UsageProfile; texts?: Set<string> }): PruneStats {
  const archive = openPmtiles(input.source);
  try {
    const { header } = archive;
    if (header.tileType !== MVT) throw new Error(`${input.source}: karo türü MVT değil (${header.tileType})`);
    if (header.tileCompression !== RAW && header.tileCompression !== GZIP) throw new Error(`${input.source}: karo sıkıştırması desteklenmiyor (${header.tileCompression})`);
    const overzoomFrom = Math.min(input.profile.maxzoom[input.kind] ?? header.maxZoom, header.maxZoom);
    const stats: PruneStats = { tiles: 0, contents: 0, bytesIn: archive.size, bytesOut: 0, features: 0, dropped: 0, layersDropped: 0, untouched: 0 };
    const tests = new Map<string, (feature: DrawFeature) => boolean>();
    const testFor = (layer: string, zoom: number): ((feature: DrawFeature) => boolean) => {
      const key = `${layer}:${zoom}`;
      let test = tests.get(key);
      if (!test) {
        test = drawnAt(input.profile, input.kind, layer, zoom, overzoomFrom);
        tests.set(key, test);
      }
      return test;
    };
    const pruneTile = (data: Buffer, zoom: number): Uint8Array => {
      const raw = header.tileCompression === GZIP ? gunzipSync(data) : data;
      const { layers, foreign } = decodeTile(raw);
      if (foreign > 0) {
        stats.untouched += 1;
        return data;
      }
      const out: Uint8Array[] = [];
      for (const bytes of layers) {
        const layer = decodeLayer(bytes);
        if (!layer) {
          stats.untouched += 1;
          out.push(bytes);
          continue;
        }
        stats.features += layer.features.length;
        const keep = keepsKey(input.profile, input.kind, layer.name);
        if (!keep) {
          stats.dropped += layer.features.length;
          stats.layersDropped += 1;
          continue;
        }
        const values = layer.values.map(decodeValue);
        const drawn = testFor(layer.name, zoom);
        const lean = pruneLayer(layer, keep, (feature) => drawn({ type: feature.type, id: featureId(feature), properties: featureProperties(layer, feature, values) }));
        stats.dropped += layer.features.length - lean.features.length;
        if (lean.features.length === 0) {
          stats.layersDropped += 1;
          continue;
        }
        if (input.texts) {
          const label = labelKeys(input.profile, input.kind, layer.name);
          const shown = new Set<number>();
          for (const feature of lean.features) for (let i = 0; i < feature.tags.length; i += 2) if (label(lean.keys[feature.tags[i] as number] as string)) shown.add(feature.tags[i + 1] as number);
          for (const index of shown) {
            const value = decodeValue(lean.values[index] as Uint8Array);
            if (value !== null) input.texts.add(String(value));
          }
        }
        out.push(encodeLayer(lean));
      }
      const tile = encodeTile(out);
      return header.tileCompression === GZIP ? gzipStable(tile) : tile;
    };
    const done = new Map<string, Uint8Array>();
    const tiles: { tileId: number; data: Uint8Array }[] = [];
    for (const entry of archive.entries) {
      const data = archive.read(entry);
      for (let i = 0; i < entry.runLength; i++) {
        const tileId = entry.tileId + i;
        const zoom = zoomOfTileId(tileId);
        const key = `${entry.offset}:${zoom}`;
        let lean = done.get(key);
        if (!lean) {
          lean = pruneTile(data, zoom);
          done.set(key, lean);
        }
        tiles.push({ tileId, data: lean });
      }
    }
    mkdirSync(dirname(input.target), { recursive: true });
    const metadata = { ...archive.metadata, [PRUNE_MARK]: input.profile.digest };
    const written = writePmtiles(input.target, { tileCompression: header.tileCompression, tileType: header.tileType, minZoom: header.minZoom, maxZoom: header.maxZoom, boundsE7: header.boundsE7, centerZoom: header.centerZoom, centerE7: header.centerE7 }, metadata, tiles);
    return { ...stats, tiles: written.addressed, contents: written.contents, bytesOut: written.bytes };
  } finally {
    archive.close();
  }
}

export function textRanges(texts: Iterable<string>): Set<number> {
  const ranges = new Set<number>(KEPT_RANGES);
  const add = (text: string): void => {
    for (let i = 0; i < text.length; i++) ranges.add(text.charCodeAt(i) >> 8);
  };
  for (const text of texts) {
    add(text);
    add(upperTr(text));
    add(text.toUpperCase());
    add(text.toLowerCase());
  }
  return ranges;
}

function readVarint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let factor = 1;
  for (let pos = at; ; pos++) {
    if (pos >= bytes.length) throw new Error('glif dosyası yarıda kesildi');
    const byte = bytes[pos] as number;
    value += (byte % 128) * factor;
    if (byte < 128) return [value, pos + 1];
    factor *= 128;
  }
}

function fields(bytes: Uint8Array): { key: number; start: number; end: number; body?: Uint8Array }[] {
  const out: { key: number; start: number; end: number; body?: Uint8Array }[] = [];
  for (let at = 0; at < bytes.length; ) {
    const [key, next] = readVarint(bytes, at);
    const wire = key % 8;
    let end: number;
    let body: Uint8Array | undefined;
    if (wire === 0) end = readVarint(bytes, next)[1];
    else if (wire === 1) end = next + 8;
    else if (wire === 5) end = next + 4;
    else if (wire === 2) {
      const [length, start] = readVarint(bytes, next);
      end = start + length;
      body = bytes.subarray(start, end);
    } else throw new Error(`glif dosyasında desteklenmeyen kablo türü ${wire}`);
    if (end > bytes.length) throw new Error('glif dosyası yarıda kesildi');
    out.push({ key, start: at, end, ...(body ? { body } : {}) });
    at = end;
  }
  return out;
}

function lengthPrefix(length: number): number[] {
  const out: number[] = [];
  let rest = length;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

export function stubGlyphs(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const field of fields(bytes)) {
    if (field.key !== 10 || !field.body) {
      parts.push(bytes.subarray(field.start, field.end));
      continue;
    }
    const body = field.body;
    const kept = fields(body).filter((inner) => inner.key !== 26).map((inner) => body.subarray(inner.start, inner.end));
    parts.push(Uint8Array.from([10, ...lengthPrefix(kept.reduce((sum, part) => sum + part.length, 0))]), ...kept);
  }
  return Buffer.concat(parts);
}

function place(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  rmSync(target, { force: true });
  try {
    linkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')]));
}

const RANGE_FILE = /(^|\/)(\d+)-(\d+)\.pbf$/;

export function pruneGlyphs(input: { sourceDir: string; targetDir: string; ranges: Set<number> }): GlyphStats {
  const stats: GlyphStats = { files: 0, stubs: 0, bytesIn: 0, bytesOut: 0 };
  for (const rel of listFiles(input.sourceDir).filter((path) => !path.endsWith('.tmp')).sort()) {
    const source = join(input.sourceDir, rel);
    const target = join(input.targetDir, rel);
    const size = statSync(source).size;
    stats.files += 1;
    stats.bytesIn += size;
    const range = RANGE_FILE.exec(rel);
    if (!range || input.ranges.has(Number(range[2]) / 256)) {
      place(source, target);
      stats.bytesOut += size;
      continue;
    }
    const stub = stubGlyphs(readFileSync(source));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(`${target}.tmp`, stub);
    renameSync(`${target}.tmp`, target);
    stats.stubs += 1;
    stats.bytesOut += stub.length;
  }
  return stats;
}

export function hoodTexts(addressFile: string, texts: Set<string>): void {
  if (!existsSync(addressFile)) return;
  const db = new DatabaseSync(addressFile, { readOnly: true });
  try {
    const walk = (value: unknown): void => {
      if (typeof value === 'string') texts.add(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    for (const row of db.prepare('SELECT name, extra FROM neighbourhood UNION ALL SELECT name, extra FROM district').all() as { name: string; extra: string }[]) {
      texts.add(row.name);
      walk(JSON.parse(row.extra));
    }
  } finally {
    db.close();
  }
}

export type PruneInput = {
  plates: string[];
  tiles: (plate: string) => { source: string; target: string };
  places: (plate: string) => { source: string; target: string };
  addressFile: (plate: string) => string;
  base: { source: string; target: string };
  profile?: UsageProfile;
  log?: (line: string) => void;
};

export function pruneBuild(input: PruneInput): PruneReport {
  const profile = input.profile ?? usageProfile(styleVariants());
  const texts = new Set<string>(profile.literals);
  const files: Record<string, PruneStats> = {};
  const mb = (bytes: number): string => (bytes / 1e6).toFixed(2);
  const prune = (name: string, kind: SourceKind, paths: { source: string; target: string }): void => {
    if (!existsSync(paths.source)) {
      rmSync(paths.target, { force: true });
      return;
    }
    const stats = pruneTileArchive({ ...paths, kind, profile, texts });
    files[name] = stats;
    input.log?.(`budama ${name}: ${mb(stats.bytesIn)} → ${mb(stats.bytesOut)} MB, ${stats.dropped}/${stats.features} nesne çizilmiyordu`);
  };
  rmSync(input.base.target, { recursive: true, force: true });
  for (const plate of input.plates) {
    prune(`${plate}/tiles`, 'tiles', input.tiles(plate));
    prune(`${plate}/places`, 'places', input.places(plate));
    hoodTexts(input.addressFile(plate), texts);
  }
  prune('overview', 'overview', { source: join(input.base.source, 'overview.pmtiles'), target: join(input.base.target, 'overview.pmtiles') });
  const ranges = textRanges(texts);
  const glyphs = { files: 0, stubs: 0, bytesIn: 0, bytesOut: 0 };
  for (const rel of listFiles(input.base.source).filter((path) => !path.endsWith('.tmp')).sort()) {
    if (rel === 'overview.pmtiles' || rel.startsWith('fonts-compact/')) continue;
    place(join(input.base.source, rel), join(input.base.target, rel));
  }
  if (existsSync(join(input.base.source, 'fonts-compact'))) Object.assign(glyphs, pruneGlyphs({ sourceDir: join(input.base.source, 'fonts-compact'), targetDir: join(input.base.target, 'fonts-compact'), ranges }));
  input.log?.(`yazı tipleri: ${ranges.size} aralık gerekli, ${glyphs.stubs} dosya boşaltıldı, ${mb(glyphs.bytesIn)} → ${mb(glyphs.bytesOut)} MB`);
  return { profile: profile.digest, ranges: ranges.size, files, glyphs };
}
