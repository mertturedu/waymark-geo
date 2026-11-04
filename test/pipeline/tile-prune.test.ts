import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { decodeLayer, decodeTile, decodeValue, encodeLayer, encodeTile, featureProperties, type MvtFeature, type MvtLayer } from '../../pipeline/build/mvt';
import { gzipStable, openPmtiles, tileIdOf, writePmtiles, type TileSetInfo } from '../../pipeline/build/pmtiles-file';
import { hoodTexts, KEPT_RANGES, PRUNE_MARK, pruneBuild, pruneGlyphs, pruneTileArchive, stubGlyphs, textRanges } from '../../pipeline/build/tile-prune';
import { usageProfile } from '../../pipeline/build/tile-usage';
import type { MapStyle, StyleLayer } from '../../src/native/map/style';

const utf8 = new TextEncoder();
const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
};
const field = (key: number, body: number[]): number[] => [...varint(key), ...varint(body.length), ...body];
const value = (v: string | number): Uint8Array => Uint8Array.from(typeof v === 'string' ? field(10, [...utf8.encode(v)]) : [32, ...varint(v)]);

function layer(name: string, rows: Record<string, string | number>[]): MvtLayer {
  const keys: string[] = [];
  const values: (string | number)[] = [];
  const index = <T>(list: T[], item: T): number => (list.includes(item) ? list.indexOf(item) : list.push(item) - 1);
  const features: MvtFeature[] = rows.map((row, i) => ({
    id: Uint8Array.from(varint(i + 1)),
    tags: Object.entries(row).flatMap(([k, v]) => [index(keys, k), index(values, v)]),
    type: 1,
    geometry: Uint8Array.from([9, 2 * i, 2 * i]),
    order: [1, 2, 3, 4],
  }));
  return { name, version: 2, extent: 4096, keys, values: values.map(value), features, order: [15, 1, 2, 3, 4, 5] };
}

const tile = (...layers: MvtLayer[]): Uint8Array => gzipStable(encodeTile(layers.map(encodeLayer)));
const info: TileSetInfo = { tileCompression: 2, tileType: 1, minZoom: 14, maxZoom: 15, boundsE7: [289000000, 401000000, 291000000, 402000000], centerZoom: 14, centerE7: [290000000, 401500000] };
const style: MapStyle = {
  version: 8,
  sources: { base: { type: 'vector', maxzoom: 8 }, r16: { type: 'vector', maxzoom: 15 }, ov16: { type: 'vector', maxzoom: 16 } },
  layers: [
    { id: 'pois', type: 'symbol', source: 'r16', 'source-layer': 'pois', filter: ['>=', ['zoom'], ['get', 'min_zoom']], layout: { 'text-field': ['coalesce', ['get', 'name:tr'], ['get', 'name']] } },
    { id: 'water', type: 'fill', source: 'r16', 'source-layer': 'water', filter: ['==', ['get', 'kind'], 'lake'] },
    { id: 'places', type: 'symbol', source: 'ov16', 'source-layer': 'places', layout: { 'text-field': ['get', 'name'] } },
    { id: 'base-water', type: 'fill', source: 'base', 'source-layer': 'water' },
  ] as StyleLayer[],
};
const profile = usageProfile([style]);
const dir = (): string => mkdtempSync(join(tmpdir(), 'prune-'));

function layersOf(path: string): Map<number, Map<string, Record<string, unknown>[]>> {
  const archive = openPmtiles(path);
  const out = new Map<number, Map<string, Record<string, unknown>[]>>();
  for (const entry of archive.entries) {
    const layers = new Map<string, Record<string, unknown>[]>();
    for (const bytes of decodeTile(gunzipSync(archive.read(entry))).layers) {
      const decoded = decodeLayer(bytes) as MvtLayer;
      const values = decoded.values.map(decodeValue);
      layers.set(decoded.name, decoded.features.map((f) => featureProperties(decoded, f, values)));
    }
    for (let i = 0; i < entry.runLength; i++) out.set(entry.tileId + i, layers);
  }
  archive.close();
  return out;
}

const pois = (): MvtLayer => layer('pois', [
  { kind: 'cafe', min_zoom: 14, name: 'Kahve Evi', 'name:de': 'Kaffeehaus', sort_rank: 3 },
  { kind: 'school', min_zoom: 17, name: 'Okul' },
]);
const water = (): MvtLayer => layer('water', [{ kind: 'lake', name: 'Göl', sort_rank: 1 }, { kind: 'ocean', name: 'Deniz' }]);

describe('pruneTileArchive', () => {
  const z14 = tileIdOf(14, 9500, 6100);
  const z15 = tileIdOf(15, 19000, 12200);

  function build(): { source: string; target: string; texts: Set<string> } {
    const root = dir();
    const source = join(root, 'in.pmtiles');
    writePmtiles(source, info, { name: 'kaynak' }, [
      { tileId: z14, data: tile(pois(), water(), layer('landcover', [{ kind: 'forest' }])) },
      { tileId: z14 + 1, data: tile(pois(), water(), layer('landcover', [{ kind: 'forest' }])) },
      { tileId: z15, data: tile(pois()) },
    ].sort((a, b) => a.tileId - b.tileId));
    return { source, target: join(root, 'out', 'out.pmtiles'), texts: new Set<string>() };
  }

  it('drops what the style never draws and keeps what it does', () => {
    const { source, target, texts } = build();
    const stats = pruneTileArchive({ source, target, kind: 'tiles', profile, texts });
    const out = layersOf(target);
    expect([...(out.get(z14) as Map<string, unknown>).keys()]).toEqual(['pois', 'water']);
    expect(out.get(z14)?.get('pois')).toEqual([{ kind: 'cafe', min_zoom: 14, name: 'Kahve Evi', 'name:de': 'Kaffeehaus' }]);
    expect(out.get(z14)?.get('water')).toEqual([{ kind: 'lake', name: 'Göl' }]);
    expect(out.get(z15)?.get('pois')).toEqual([{ kind: 'cafe', min_zoom: 14, name: 'Kahve Evi', 'name:de': 'Kaffeehaus' }, { kind: 'school', min_zoom: 17, name: 'Okul' }]);
    expect(stats).toMatchObject({ tiles: 3, contents: 2, features: 7, dropped: 3, layersDropped: 1, untouched: 0 });
    expect([...texts].sort()).toEqual(['Göl', 'Kaffeehaus', 'Kahve Evi', 'Okul']);
  });

  it('keeps the header, marks the metadata and writes the same file twice', () => {
    const { source, target } = build();
    pruneTileArchive({ source, target, kind: 'tiles', profile });
    const archive = openPmtiles(target);
    expect(archive.header).toMatchObject(info);
    expect(archive.metadata).toEqual({ name: 'kaynak', [PRUNE_MARK]: profile.digest });
    archive.close();
    const again = join(dir(), 'again.pmtiles');
    pruneTileArchive({ source, target: again, kind: 'tiles', profile });
    expect(readFileSync(again).equals(readFileSync(target))).toBe(true);
  });

  it('passes through layers it cannot read back exactly', () => {
    const root = dir();
    const source = join(root, 'in.pmtiles');
    const odd = Uint8Array.from([...encodeLayer(water()), 48, 1]);
    writePmtiles(source, info, {}, [{ tileId: z14, data: gzipStable(encodeTile([odd])) }]);
    const stats = pruneTileArchive({ source, target: join(root, 'out.pmtiles'), kind: 'tiles', profile });
    expect(stats.untouched).toBe(1);
    const archive = openPmtiles(join(root, 'out.pmtiles'));
    expect(Buffer.from(decodeTile(gunzipSync(archive.read(archive.entries[0]!))).layers[0]!).equals(Buffer.from(odd))).toBe(true);
    archive.close();
  });

  it('refuses archives that are not vector tiles', () => {
    const root = dir();
    writePmtiles(join(root, 'png.pmtiles'), { ...info, tileType: 2 }, {}, [{ tileId: z14, data: Uint8Array.from([1]) }]);
    expect(() => pruneTileArchive({ source: join(root, 'png.pmtiles'), target: join(root, 'o.pmtiles'), kind: 'tiles', profile })).toThrow(/MVT/);
  });
});

describe('textRanges', () => {
  it('keeps the scripts every app needs and adds what the labels use', () => {
    const ranges = textRanges(['ışık', 'Ბ', 'ა', '😀']);
    for (const range of KEPT_RANGES) expect(ranges.has(range)).toBe(true);
    expect(ranges.has(0x01)).toBe(true);
    expect(ranges.has(0x10)).toBe(true);
    expect(ranges.has(0x1c)).toBe(true);
    expect(ranges.has(0xd8)).toBe(true);
    expect(ranges.has(0xde)).toBe(true);
    expect(ranges.has(0x0c)).toBe(false);
    expect(ranges.has(0xfc)).toBe(false);
  });
});

const glyphFile = (name: string, range: string, glyphs: number): Uint8Array => {
  const body = [...field(10, [...utf8.encode(name)]), ...field(18, [...utf8.encode(range)]), ...Array.from({ length: glyphs }, (_, i) => field(26, [8, ...varint(i + 65), 16, 10, 24, 12]).flat()).flat()];
  return Uint8Array.from(field(10, body));
};

describe('glyph files', () => {
  it('keep the name and range of an emptied range file', () => {
    expect([...stubGlyphs(glyphFile('Noto Sans Regular', '2048-2303', 3))]).toEqual([...glyphFile('Noto Sans Regular', '2048-2303', 0)]);
  });

  it('copy the needed ranges and empty the rest', () => {
    const root = dir();
    const source = join(root, 'fonts');
    mkdirSync(join(source, 'NotoSansRegular'), { recursive: true });
    writeFileSync(join(source, 'NotoSansRegular', '0-255.pbf'), glyphFile('Noto Sans Regular', '0-255', 5));
    writeFileSync(join(source, 'NotoSansRegular', '2048-2303.pbf'), glyphFile('Noto Sans Regular', '2048-2303', 5));
    writeFileSync(join(source, 'README'), 'not a range');
    const stats = pruneGlyphs({ sourceDir: source, targetDir: join(root, 'out'), ranges: new Set([0]) });
    expect(readFileSync(join(root, 'out', 'NotoSansRegular', '0-255.pbf')).equals(readFileSync(join(source, 'NotoSansRegular', '0-255.pbf')))).toBe(true);
    expect([...readFileSync(join(root, 'out', 'NotoSansRegular', '2048-2303.pbf'))]).toEqual([...glyphFile('Noto Sans Regular', '2048-2303', 0)]);
    expect(readFileSync(join(root, 'out', 'README'), 'utf8')).toBe('not a range');
    expect(stats).toMatchObject({ files: 3, stubs: 1 });
    expect(stats.bytesOut).toBeLessThan(stats.bytesIn);
  });
});

function addressPack(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE neighbourhood (name TEXT, extra TEXT); CREATE TABLE district (name TEXT, extra TEXT); INSERT INTO neighbourhood VALUES ('Çınarcık', '{\"names\":{\"el\":\"Τσιναρτζίκ\"},\"alt\":[\"Eski Ad\"]}'); INSERT INTO district VALUES ('Nilüfer', '{\"names\":{}}');");
  db.close();
}

describe('hoodTexts', () => {
  it('reads neighbourhood and district names in every language', () => {
    const path = join(dir(), 'address.sqlite');
    addressPack(path);
    const texts = new Set<string>();
    hoodTexts(path, texts);
    expect([...texts].sort()).toEqual(['Eski Ad', 'Nilüfer', 'Çınarcık', 'Τσιναρτζίκ']);
    hoodTexts(join(dir(), 'missing.sqlite'), texts);
    expect(texts.size).toBe(4);
  });
});

describe('pruneBuild', () => {
  it('prunes tiles, places and the base pack and removes outputs whose source is gone', () => {
    const root = dir();
    const z14 = tileIdOf(14, 9500, 6100);
    writePmtiles(join(root, 'tiles.pmtiles'), info, {}, [{ tileId: z14, data: tile(pois(), layer('landcover', [{ kind: 'forest' }])) }]);
    mkdirSync(join(root, 'out'), { recursive: true });
    writeFileSync(join(root, 'out', 'stale-places.pmtiles'), 'old');
    const base = join(root, 'base');
    mkdirSync(join(base, 'fonts-compact', 'NotoSansMedium'), { recursive: true });
    mkdirSync(join(base, 'sprites', 'v4'), { recursive: true });
    writePmtiles(join(base, 'overview.pmtiles'), { ...info, minZoom: 0, maxZoom: 8, centerZoom: 0 }, {}, [{ tileId: 0, data: tile(water(), layer('roads', [{ kind: 'highway' }])) }]);
    writeFileSync(join(base, 'sprites', 'v4', 'light.json'), '{}');
    writeFileSync(join(base, 'fonts-compact', 'NotoSansMedium', '0-255.pbf'), glyphFile('Noto Sans Medium', '0-255', 4));
    writeFileSync(join(base, 'fonts-compact', 'NotoSansMedium', '3328-3583.pbf'), glyphFile('Noto Sans Medium', '3328-3583', 4));
    const address = join(root, 'address.sqlite');
    addressPack(address);
    const logs: string[] = [];
    const report = pruneBuild({
      plates: ['16'],
      tiles: () => ({ source: join(root, 'tiles.pmtiles'), target: join(root, 'out', 'tiles.pmtiles') }),
      places: () => ({ source: join(root, 'no-places.pmtiles'), target: join(root, 'out', 'stale-places.pmtiles') }),
      addressFile: () => address,
      base: { source: base, target: join(root, 'out', 'base') },
      profile,
      log: (line) => logs.push(line),
    });
    expect(Object.keys(report.files)).toEqual(['16/tiles', 'overview']);
    expect(existsSync(join(root, 'out', 'stale-places.pmtiles'))).toBe(false);
    expect(readFileSync(join(root, 'out', 'base', 'sprites', 'v4', 'light.json'), 'utf8')).toBe('{}');
    expect(layersOf(join(root, 'out', 'base', 'overview.pmtiles')).get(0)?.has('roads')).toBe(false);
    expect(readFileSync(join(root, 'out', 'base', 'fonts-compact', 'NotoSansMedium', '0-255.pbf')).length).toBeGreaterThan(40);
    expect([...readFileSync(join(root, 'out', 'base', 'fonts-compact', 'NotoSansMedium', '3328-3583.pbf'))]).toEqual([...glyphFile('Noto Sans Medium', '3328-3583', 0)]);
    expect(report).toMatchObject({ profile: profile.digest, glyphs: { files: 2, stubs: 1 } });
    expect(logs.some((line) => line.startsWith('yazı tipleri'))).toBe(true);
  });
});
