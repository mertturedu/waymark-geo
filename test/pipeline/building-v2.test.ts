import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { componentsOf, floorsOf, indexOf, link, sequence, type Chain } from '../../pipeline/build/building-link';
import { attachEntrances, namedBuildings, prepare, rerank, settlementsOf, writeBuildingPack, type Entrance, type Trace } from '../../pipeline/build/building-pack-v2';
import { openBuildings2 } from '../../src/core/address/buildings2';
import { openSqlite } from '../../src/node/sqlite';

const street: Chain = { id: 7, name: 'Papatya Sokağı', lines: [[[29.0, 41.0], [29.002, 41.0]], [[29.002, 41.0], [29.004, 41.0]]] };

const box = (lon: number, lat: number, size = 0.00012): [number, number][] => [[lon - size, lat - size], [lon + size, lat - size], [lon + size, lat + size], [lon - size, lat + size]];
const trace = (id: string, lon: number, lat: number, extra: Partial<Trace> = {}): Trace => ({ id, lon, lat, area: 150, ring: box(lon, lat), height: null, floors: null, name: null, cls: null, src: null, rec: null, ...extra });

describe('componentsOf', () => {
  it('joins parts that meet into one ordered path', () => {
    const [only] = componentsOf([street]);
    expect(componentsOf([street])).toHaveLength(1);
    expect(only?.path).toHaveLength(3);
    expect(only?.cumulative[2]).toBeGreaterThan(300);
  });
});

describe('link', () => {
  const index = indexOf(componentsOf([street]));

  it('ties a building to the chain with its side and distance', () => {
    const north = link(index, { id: 'a', lon: 29.001, lat: 41.0003, area: 120 });
    const south = link(index, { id: 'b', lon: 29.001, lat: 40.9997, area: 120 });
    expect(north).toMatchObject({ chain: 7 });
    expect(south).toMatchObject({ chain: 7 });
    expect(north?.side).toBe(-south!.side);
    expect(north!.distanceM).toBeGreaterThan(20);
    expect(north!.distanceM).toBeLessThan(40);
  });

  it('leaves a far building alone and marks a corner building with the second chain', () => {
    expect(link(index, { id: 'c', lon: 29.001, lat: 41.01, area: 100 })).toBeNull();
    const cross: Chain = { id: 9, name: 'Lale Sokağı', lines: [[[29.001, 40.999], [29.001, 41.001]]] };
    const both = indexOf(componentsOf([street, cross]));
    expect(link(both, { id: 'd', lon: 29.00115, lat: 41.00012, area: 100 })?.second?.chain).toBeDefined();
  });
});

describe('sequence', () => {
  it('counts buildings along each side in order and skips tiny ones', () => {
    const index = indexOf(componentsOf([street]));
    const items = [29.0005, 29.0025, 29.0015].map((lon, i) => ({ id: `n${i}`, area: 100, link: link(index, { id: `n${i}`, lon, lat: 41.0003, area: 100 })! }));
    items.push({ id: 'tiny', area: 10, link: link(index, { id: 'tiny', lon: 29.002, lat: 41.0003, area: 10 })! });
    const order = sequence(items);
    expect([order.get('n0'), order.get('n2'), order.get('n1')]).toEqual([1, 2, 3]);
    expect(order.has('tiny')).toBe(false);
  });
});

describe('floorsOf', () => {
  it('prefers num_floors over OSM levels over height over the region', () => {
    expect(floorsOf({ numFloors: 5, osmLevels: 3, height: 30, fallback: 2 })).toEqual({ floors: 5, source: 1 });
    expect(floorsOf({ numFloors: null, osmLevels: 3, height: 30, fallback: 2 })).toEqual({ floors: 3, source: 2 });
    expect(floorsOf({ numFloors: null, osmLevels: null, height: 14, fallback: 2 })).toEqual({ floors: 5, source: 3 });
    expect(floorsOf({ numFloors: null, osmLevels: null, height: null, fallback: 2 })).toEqual({ floors: 2, source: 4 });
  });
});

describe('building pack v2', () => {
  it('writes a pack the reader can query by point, area, street and entrance', async () => {
    const traces = [trace('g1', 29.0005, 41.0003, { floors: 6, rec: 'w1@3' }), trace('g2', 29.0015, 41.0003, { height: 12, name: 'Güneş Apartmanı' }), trace('g3', 29.0025, 40.9997, { rec: 'w3@1' })];
    const tags = new Map([['w3', { id: 'w3', levels: 4, name: null, street: 'Papatya Sokağı', number: '3' }]]);
    const rows = prepare(traces, [street], tags);
    const entrance: Entrance = { id: 'n1', lon: 29.0005, lat: 41.00018, kind: 'main', ref: 'A', flats: '1-12', unit: null };
    const file = join(mkdtempSync(join(tmpdir(), 'b2-')), 'buildings2.sqlite');
    const places = settlementsOf([{ id: 'n9', name: 'Çamlıköy', kind: 'village', lon: 29.0012, lat: 41.0001 }, { id: 'n8', name: 'Uzakköy', kind: 'hamlet', lon: 29.5, lat: 41.5 }], rows);
    const stats = writeBuildingPack(file, '34', rows, attachEntrances(rows, [entrance]), 't', places);
    expect(stats).toMatchObject({ buildings: 3, linked: 3, entrances: 1 });
    const db = openSqlite(file);
    try {
      const reader = await openBuildings2(db);
      const here = await reader.at([29.0005, 41.0003]);
      expect(here).toMatchObject({ gid: 'g1', levels: 6, levelsSource: 'num_floors', chain: 7 });
      expect((await reader.at([29.0015, 41.0003]))).toMatchObject({ gid: 'g2', levels: 4, levelsSource: 'height', name: 'Güneş Apartmanı' });
      expect((await reader.at([29.0025, 40.9997]))).toMatchObject({ gid: 'g3', levels: 4, levelsSource: 'osm' });
      expect(await reader.at([29.0010, 41.0010])).toBeNull();
      const near = await reader.near([29.0010, 41.0003], 80);
      expect(near.map((n) => n.building.gid).sort()).toEqual(['g1', 'g2']);
      const left = await reader.ofStreet(7, here!.side === 'left' ? 'left' : 'right');
      expect(left.map((b) => b.gid)).toEqual(['g1', 'g2']);
      expect(left.map((b) => b.sequence)).toEqual([1, 2]);
      const stretch = await reader.alongStreet(7, here?.part as number, (here?.along as number) - 1, (here?.along as number) + 1);
      expect(stretch.map((b) => b.gid)).toContain('g1');
      expect(await reader.alongStreet(7, here?.part as number, 1e9, 2e9)).toEqual([]);
      expect(here?.part).toBe(rows[0]?.link?.component);
      const villages = await reader.settlements([29.001, 41.0], 600);
      expect(villages.map((v) => v.settlement.name)).toEqual(['Çamlıköy']);
      expect(villages[0]?.settlement.buildings).toBe(3);
      expect(await reader.entrances(here!.id)).toEqual([expect.objectContaining({ ref: 'A', flats: '1-12', kind: 'main' })]);
    } finally {
      await db.close();
    }
  });

  it('keeps a table of building names the reader looks up by the start of the name, and works without it', async () => {
    const traces = [trace('n1', 29.0005, 41.0003, { name: 'Güneş Apartmanı' }), trace('n2', 29.0015, 41.0003, { name: 'Güneş Plaza' }), trace('n3', 29.0025, 41.0003, { name: 'B-13' }), trace('n4', 29.0035, 41.0003, { name: '81' }), trace('n5', 29.0045, 41.0003)];
    const rows = prepare(traces, [street], new Map());
    expect(namedBuildings(rows).map((n) => n[0])).toEqual(['gunes apartmani', 'gunes plaza']);
    const file = join(mkdtempSync(join(tmpdir(), 'b2-')), 'buildings2.sqlite');
    writeBuildingPack(file, '34', rows, new Map(), 't');
    const db = openSqlite(file);
    try {
      const reader = await openBuildings2(db);
      expect((await reader.named('gunes')).map((n) => [n.key, n.building.name])).toEqual([['gunes apartmani', 'Güneş Apartmanı'], ['gunes plaza', 'Güneş Plaza']]);
      expect((await reader.named('gunes pl')).map((n) => n.key)).toEqual(['gunes plaza']);
      expect(await reader.named('yok')).toEqual([]);
      expect(await reader.named('')).toEqual([]);
      expect(await reader.named('gunes', 1)).toHaveLength(1);
    } finally {
      await db.close();
    }
  });

  it('refuses a pack of another format', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'b2-')), 'old.sqlite');
    const { DatabaseSync } = await import('node:sqlite');
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL); INSERT INTO meta VALUES ('format', '1')");
    raw.close();
    const db = openSqlite(file);
    try {
      await expect(openBuildings2(db)).rejects.toThrow('desteklenmeyen');
    } finally {
      await db.close();
    }
  });
});

describe('rerank', () => {
  const near: Chain = { id: 1, name: 'Yakın Sokak', lines: [[[29.0, 41.00014], [29.003, 41.00014]]] };
  const far: Chain = { id: 2, name: 'Uzak Sokak', lines: [[[29.0, 40.99982], [29.003, 40.99982]]] };

  it('moves a building to the chain its labelled neighbours belong to, never counting its own door', () => {
    const traces = [trace('a', 29.001, 41.0), trace('b', 29.0013, 41.0), trace('c', 29.0016, 41.0)];
    const index = indexOf(componentsOf([near, far]));
    const links = traces.map((t) => link(index, { id: t.id, lon: t.lon, lat: t.lat, area: 150, ring: t.ring }));
    expect(links.map((l) => l?.chain)).toEqual([1, 1, 1]);
    rerank(traces, links, [{ lon: 29.0013, lat: 41.0, street: 2 }, { lon: 29.0016, lat: 41.0, street: 2 }]);
    expect(links[0]?.chain).toBe(2);
    expect(links[1]?.chain).toBe(2);
    expect(links[2]?.chain).toBe(2);
  });

  it('leaves a building alone when the only label is its own', () => {
    const traces = [trace('a', 29.001, 41.0)];
    const index = indexOf(componentsOf([near, far]));
    const links = traces.map((t) => link(index, { id: t.id, lon: t.lon, lat: t.lat, area: 150, ring: t.ring }));
    rerank(traces, links, [{ lon: 29.001, lat: 41.0, street: 2 }]);
    expect(links[0]?.chain).toBe(1);
  });
});

describe('prepare with degenerate footprints', () => {
  it('leaves out a footprint with no area and keeps small real ones', () => {
    const t = (id: string, area: number): Trace => ({ id, lon: 29, lat: 41, area, ring: [[29, 41], [29.0001, 41], [29.0001, 41.0001]], height: null, floors: null, name: null, cls: null, src: null, rec: null });
    const rows = prepare([t('a', 0), t('b', 0.4), t('c', 1), t('d', 30)], [], new Map());
    expect(rows.map((r) => r.trace.id)).toEqual(['c', 'd']);
  });
});
