import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildLearned } from '../../pipeline/build/learned';
import { prepare, writeBuildingPack, type Entrance, type Trace } from '../../pipeline/build/building-pack-v2';
import type { DeliveryRecord } from '../../pipeline/real/records';
import { createSearch } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import { createLearnedLayer } from '../../src/core/learned/layer';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { part, where } from '../pipeline/helpers/mini-work';
import { richRows } from './helpers/mini-pack';
import { builtPack, turkeyBorders } from './helpers/search-fixture';

const box = (lon: number, lat: number): [number, number][] => [[lon - 0.00004, lat - 0.00003], [lon + 0.00004, lat - 0.00003], [lon + 0.00004, lat + 0.00003], [lon - 0.00004, lat + 0.00003]];
const QUERY = 'Bahariye Caddesi 10 B Blok Daire 14 Kadıköy İstanbul';

describe('the central learned part in a search', () => {
  const dbs: SqlDb[] = [];
  afterAll(async () => {
    for (const db of dbs) await db.close();
  });

  async function world(entrances: Map<string, Entrance[]> = new Map()) {
    const source = richRows();
    source.streets.push(part('Bahariye Caddesi', where('r10', 'r20'), [[[28.6, 40.70025], [28.6026, 40.70155]]], ['w60']));
    const file = await builtPack(source);
    const raw = new DatabaseSync(file, { readOnly: true });
    const id = (raw.prepare("SELECT id FROM street_name WHERE name = 'Bahariye Caddesi'").get() as { id: number }).id;
    raw.close();
    const traces: Trace[] = [];
    for (let n = 1; n <= 24; n++) {
      const lon = 28.6 + n * 0.0001;
      const lat = n % 2 === 0 ? 40.7 + n * 0.00005 : 40.7005 + n * 0.00005;
      traces.push({ id: `b${n}`, lon, lat, area: 120, ring: box(lon, lat), height: null, floors: null, name: n === 10 ? 'A Blok' : n === 12 ? 'B Blok' : n === 5 ? 'Dadaş Plaza' : null, cls: null, src: null, rec: null });
    }
    traces.push(
      { id: 'far', lon: 20, lat: 30, area: 120, ring: box(20, 30), height: null, floors: null, name: 'Uzak Han', cls: null, src: null, rec: null },
      { id: 'lone', lon: 28.6005, lat: 40.704, area: 120, ring: box(28.6005, 40.704), height: null, floors: null, name: 'Yalnız Han', cls: null, src: null, rec: null },
      { id: 'hosp', lon: 28.6201, lat: 40.6201, area: 120, ring: box(28.6201, 40.6201), height: null, floors: null, name: 'Devlet Hastanesi', cls: null, src: null, rec: null },
    );
    const dir = mkdtempSync(join(tmpdir(), 'learned-search-'));
    const buildings = join(dir, 'buildings2.sqlite');
    writeBuildingPack(buildings, '34', prepare(traces, [{ id, name: 'Bahariye Caddesi', lines: [[[28.6, 40.70025], [28.6026, 40.70155]]] }], new Map()), entrances, 't');
    const address = openSqlite(file);
    const buildingDb = openSqlite(buildings);
    dbs.push(address, buildingDb);
    const open = (learned: SqlDb | null): PackStore => ({ installed: async () => ['34'], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildingDb : kind === 'learned' ? learned : null) });
    const probe = createSearch({ store: open(null), borders: turkeyBorders() });
    const found = await probe.resolve('Bahariye Caddesi 10 Kadıköy İstanbul');
    const best = (found.status === 'resolved' ? found.best : found.status === 'ambiguous' ? found.candidates[0] : undefined) as Place;
    return { open, dir, best };
  }

  const recordsFor = (best: Place, extra: Partial<DeliveryRecord>[]): DeliveryRecord[] =>
    extra.map((e, i) => ({ v: 1, src: e.src ?? `s${i}`, week: 2800, region: '34', district: best.components.district as string, neighbourhood: best.components.neighbourhood, street: best.components.street as string, houseNumber: best.components.houseNumber as string, coordSource: 'gps', gps: { lng: 28.6012, lat: 40.7006, accuracyM: 8 }, ...e }) as DeliveryRecord);

  it('estimates the floor from the learned layout of the block', async () => {
    const { open, dir, best } = await world();
    const pairs: [number, number][] = [[0, 1], [0, 3], [1, 5], [1, 7], [2, 9], [2, 12], [3, 14], [3, 16]];
    const records = recordsFor(best, pairs.map(([floor, door], i) => ({ src: i % 2 ? 'a' : 'b', block: 'B Blok', floor: String(floor), door: String(door) })));
    const file = join(dir, 'learned.sqlite');
    expect((await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records })).layouts).toBe(1);
    const learned = openSqlite(file);
    dbs.push(learned);
    const withLearned = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const without = createSearch({ store: open(null), borders: turkeyBorders() });
    const pick = async (s: ReturnType<typeof createSearch>) => {
      const r = await s.resolve(QUERY);
      return (r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined)?.unit?.floor;
    };
    expect(await pick(withLearned)).toMatchObject({ value: 3, low: 3, high: 3, source: 'learned' });
    expect((await pick(without))?.source).toBe('model');
  });

  it('answers a door nobody has put on the map from the delivered point', async () => {
    const { open, dir, best } = await world();
    const records = recordsFor(best, [{ src: 'a', houseNumber: '77' }, { src: 'b', houseNumber: '77' }]);
    const file = join(dir, 'door.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records });
    const learned = openSqlite(file);
    dbs.push(learned);
    const search = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const r = await search.resolve('Bahariye Caddesi 77 Kadıköy İstanbul');
    const top = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
    expect(top).toMatchObject({ source: 'learned', precision: 'address', approximate: false });
    expect(Math.abs((top?.coordinate[0] as number) - 28.6012)).toBeLessThan(0.00005);
  });

  it('arrives at the entrance the couriers agree on, else at the main entrance of the building', async () => {
    const { open, dir, best } = await world(new Map([['b10', [{ id: 'e1', lon: 28.6010, lat: 40.7005, kind: 'main', ref: '2', flats: null, unit: null }, { id: 'e2', lon: 28.6011, lat: 40.7006, kind: null, ref: '9', flats: null, unit: null }]]]));
    const plain = createSearch({ store: open(null), borders: turkeyBorders() });
    const building = await plain.arrival(best);
    expect(building.entranceRef).toBe('2');
    const written = await plain.resolve('Bahariye Caddesi 10 Giriş 9 Kadıköy İstanbul');
    const top = written.status === 'resolved' ? written.best : written.status === 'ambiguous' ? written.candidates[0] : undefined;
    expect(top?.unit?.entrance?.ref).toBe('9');
    expect((await plain.arrival(top as Place)).entranceRef).toBe('9');
    expect(building.entrance?.[0]).toBeCloseTo(28.601, 4);
    expect(building.chain?.length).toBeGreaterThan(0);
    const records = recordsFor(best, [{ src: 'a', entrance: { lng: 28.6015, lat: 40.7006 } }, { src: 'b', entrance: { lng: 28.60151, lat: 40.7006 } }]);
    const file = join(dir, 'entrance.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records });
    const learned = openSqlite(file);
    dbs.push(learned);
    const taught = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const got = await taught.arrival(best);
    expect(got.entrance?.[0]).toBeCloseTo(28.6015, 4);
    expect(got.entranceRef).toBeUndefined();
    expect((await taught.arrival({ ...best, precision: 'street' })).entrance).toBeUndefined();
    expect(await taught.arrival({ ...best, region: '' })).toEqual({ door: best.coordinate });
  });

  it('finds a building by its name, in the district it lies in', async () => {
    const { open } = await world();
    const search = createSearch({ store: open(null), borders: turkeyBorders() });
    const result = await search.resolve('Dadaş Plaza Kadıköy İstanbul');
    const top = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(top).toMatchObject({ precision: 'poi', source: 'osm', components: { poiName: 'Dadaş Plaza', district: 'Kadıköy' } });
    expect(Math.abs((top?.coordinate[0] as number) - 28.6005)).toBeLessThan(0.0002);
    const typo = await search.resolve('Dadas Plazza Kadıköy');
    expect((typo.status === 'resolved' ? typo.best : typo.status === 'ambiguous' ? typo.candidates[0] : undefined)?.components.poiName).toBe('Dadaş Plaza');
    const other = await search.resolve('Dadaş Plaza Üsküdar');
    const away = other.status === 'resolved' ? other.best : other.status === 'ambiguous' ? other.candidates[0] : undefined;
    expect(away?.components.poiName === 'Dadaş Plaza' ? away.confidence : 0).toBeLessThan(top?.confidence ?? 1);
    expect((await search.resolve('Dadaş Plaza 4 Kadıköy')).status).not.toBe('region_missing');
    const typed = await search.autocomplete('Dadaş Pla', { hints: { city: 'İstanbul' } });
    expect(typed.map((p) => p.components.poiName)).toContain('Dadaş Plaza');
    expect((await search.autocomplete('Da', { hints: { city: 'İstanbul' } })).map((p) => p.components.poiName)).not.toContain('Dadaş Plaza');
  });

  it('leaves out names it cannot place, twins of a known place and searches without the building part', async () => {
    const { open } = await world();
    const search = createSearch({ store: open(null), borders: turkeyBorders() });
    const names = async (text: string) => {
      const r = await search.resolve(text);
      return r.status === 'resolved' ? [r.best, ...r.candidates] : r.status === 'ambiguous' ? r.candidates : [];
    };
    expect((await names('Uzak Han')).map((p) => p.components.poiName)).not.toContain('Uzak Han');
    const lone = (await names('Yalnız Han Kadıköy')).find((p) => p.components.poiName === 'Yalnız Han');
    expect(lone).toMatchObject({ precision: 'poi', components: { district: 'Kadıköy' } });
    expect(lone?.components.street).toBeUndefined();
    expect((await names('Devlet Hastane Kadıköy')).filter((p) => p.id.includes(':b:'))).toEqual([]);
    await search.resolve('Da');
    const bare: PackStore = { ...open(null), openPart: async () => null };
    const without = createSearch({ store: bare, borders: turkeyBorders() });
    const r = await without.resolve('Dadaş Plaza Kadıköy');
    expect((r.status === 'resolved' ? [r.best, ...r.candidates] : r.status === 'ambiguous' ? r.candidates : []).map((p) => p.components.poiName)).not.toContain('Dadaş Plaza');
  });

  it('behaves as before when the part is not installed', async () => {
    const { open } = await world();
    const search = createSearch({ store: open(null), borders: turkeyBorders(), layers: [createLearnedLayer(open(null))] });
    const r = await search.resolve('Bahariye Caddesi 12 Kadıköy İstanbul');
    expect(r.status === 'resolved' ? r.best.source : r.status).not.toBe('learned');
  });

  it('puts a street that is not on the map at the place deliveries agree on, when three couriers wrote it', async () => {
    const { open, dir, best } = await world();
    const district = best.components.district as string;
    const records = ['a', 'b', 'c'].map((src, i) => ({ v: 1, src, week: 2800, region: '34', district, street: 'Yeni Çıkmaz Sokak', houseNumber: String(i + 1), coordSource: 'gps', neighbourhood: best.components.neighbourhood, gps: { lng: 28.6012 + i * 0.00002, lat: 40.7006, accuracyM: 8 } }) as DeliveryRecord);
    const file = join(dir, 'names.sqlite');
    expect((await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records, streetKnown: () => false })).hints).toBe(1);
    const learned = openSqlite(file);
    dbs.push(learned);
    const search = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const r = await search.resolve(`Yeni Çıkmaz Sokak 9 ${district} İstanbul`);
    const top = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
    expect(top).toMatchObject({ source: 'learned', precision: 'street', approximate: true, components: { street: 'Yeni Çıkmaz Sokak', houseNumber: '9' } });
    expect(top?.radiusM).toBeGreaterThanOrEqual(40);
    expect(Math.abs((top?.coordinate[0] as number) - 28.6012)).toBeLessThan(0.0002);
    const plain = await createSearch({ store: open(null), borders: turkeyBorders() }).resolve(`Yeni Çıkmaz Sokak 9 ${district} İstanbul`);
    expect((plain.status === 'resolved' ? plain.best : plain.status === 'ambiguous' ? plain.candidates[0] : undefined)?.source).not.toBe('learned');
  });

  it('does not use a name hint for a street that the map already has in that district', async () => {
    const { open, dir, best } = await world();
    const district = best.components.district as string;
    const records = ['a', 'b', 'c'].map((src, i) => ({ v: 1, src, week: 2800, region: '34', district, street: 'Bahariye Caddesi', houseNumber: String(i + 31), coordSource: 'gps', neighbourhood: best.components.neighbourhood, gps: { lng: 28.7, lat: 40.8, accuracyM: 8 } }) as DeliveryRecord);
    const file = join(dir, 'known.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records, streetKnown: () => false });
    const learned = openSqlite(file);
    dbs.push(learned);
    const search = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const r = await search.resolve(`Bahariye Caddesi 12 ${district} İstanbul`);
    const top = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
    expect(top?.precision).toBe('address');
    expect(top?.source).not.toBe('learned');
  });

  it('only answers a name hint for the same kind of street, in a typed district or across the province', async () => {
    const { open, dir, best } = await world();
    const district = best.components.district as string;
    const records = ['a', 'b', 'c'].map((src, i) => ({ v: 1, src, week: 2800, region: '34', district, street: 'Lale Sokak', houseNumber: String(i + 1), coordSource: 'gps', gps: { lng: 28.6012, lat: 40.7006, accuracyM: 8 } }) as DeliveryRecord);
    const file = join(dir, 'kinds.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: file, records, streetKnown: () => false });
    const learned = openSqlite(file);
    dbs.push(learned);
    const search = createSearch({ store: open(learned), borders: turkeyBorders(), layers: [createLearnedLayer(open(learned))] });
    const source = async (text: string): Promise<string | undefined> => {
      const r = await search.resolve(text);
      return (r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined)?.source;
    };
    expect(await source(`Lale Sokak ${district} İstanbul`)).toBe('learned');
    expect(await source(`Lale Caddesi 9 ${district} İstanbul`)).not.toBe('learned');
    expect(await source('Lale Sokak 9 İstanbul')).toBe('learned');
    expect(await source('Lale Caddesi 9 İstanbul')).not.toBe('learned');
    expect(await source(`Menekşe Sokak 9 ${district} İstanbul`)).not.toBe('learned');
  });
});
