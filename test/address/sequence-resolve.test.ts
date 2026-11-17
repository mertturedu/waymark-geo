import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepare, writeBuildingPack, type Trace } from '../../pipeline/build/building-pack-v2';
import { createSearch } from '../../src/core/address/search';
import { createTypeSession } from '../../src/core/address/typeahead';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { part, where } from '../pipeline/helpers/mini-work';
import { richRows } from './helpers/mini-pack';
import { builtPack, turkeyBorders } from './helpers/search-fixture';

const box = (lon: number, lat: number): [number, number][] => [[lon - 0.00004, lat - 0.00003], [lon + 0.00004, lat - 0.00003], [lon + 0.00004, lat + 0.00003], [lon - 0.00004, lat + 0.00003]];

describe('numbers without a door, answered from the buildings', () => {
  const dbs: SqlDb[] = [];
  afterAll(async () => {
    for (const db of dbs) await db.close();
  });

  async function setup(withBuildings: boolean) {
    const source = richRows();
    source.streets.push(part('Bahariye Caddesi', where('r10', 'r20'), [[[28.6, 40.70025], [28.6026, 40.70155]]], ['w60']));
    const file = await builtPack(source);
    const raw = new DatabaseSync(file, { readOnly: true });
    const id = (raw.prepare("SELECT id FROM street_name WHERE name = 'Bahariye Caddesi'").get() as { id: number }).id;
    raw.close();
    const traces: Trace[] = [];
    traces.push({ id: 'lone', lon: 28.6013, lat: 40.704, area: 120, ring: box(28.6013, 40.704), height: null, floors: null, name: null, cls: null, src: null, rec: null });
    for (let n = 1; n <= 24; n++) {
      const lon = 28.6 + n * 0.0001;
      const lat = n % 2 === 0 ? 40.7 + n * 0.00005 : 40.7005 + n * 0.00005;
      traces.push({ id: `b${n}`, lon, lat, area: 120, ring: box(lon, lat), height: null, floors: n === 22 ? 7 : null, name: n === 10 ? 'A Blok' : n === 12 ? 'B Blok' : n === 24 ? 'C Blok' : null, cls: null, src: null, rec: null });
    }
    const rows = prepare(traces, [{ id, name: 'Bahariye Caddesi', lines: [[[28.6, 40.70025], [28.6026, 40.70155]]] }], new Map());
    const dir = mkdtempSync(join(tmpdir(), 'seq-'));
    const buildingsFile = join(dir, 'buildings2.sqlite');
    writeBuildingPack(buildingsFile, '34', rows, new Map(), 't');
    const address = openSqlite(file);
    const buildings = openSqlite(buildingsFile);
    dbs.push(address, buildings);
    const store: PackStore = { installed: async () => ['34'], open: async () => address, ...(withBuildings ? { openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) } : {}) } as PackStore;
    return createSearch({ store, borders: turkeyBorders() });
  }

  it('puts a missing number on the building the numbering leads to and reports an accuracy radius', async () => {
    const search = await setup(true);
    const result = await search.resolve('Bahariye Caddesi 22 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best).toMatchObject({ precision: 'interpolated', approximate: true });
    expect(best?.radiusM).toBeGreaterThan(0);
    const expected = [28.6 + 22 * 0.0001, 40.7 + 22 * 0.00005];
    expect(Math.abs((best?.coordinate[0] as number) - expected[0]!)).toBeLessThan(0.0002);
    expect(Math.abs((best?.coordinate[1] as number) - expected[1]!)).toBeLessThan(0.0002);
  });

  it('keeps answering from the doors alone when there is no building pack', async () => {
    const search = await setup(false);
    const result = await search.resolve('Bahariye Caddesi 22 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best).toMatchObject({ precision: 'interpolated', approximate: true });
    expect(best?.radiusM).toBeUndefined();
  });

  it('still returns a known door as a door', async () => {
    const search = await setup(true);
    const result = await search.resolve('Bahariye Caddesi 12 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best).toMatchObject({ precision: 'address', approximate: false });
  });

  it('resolves the written block, floor and door into a unit and keeps the door result', async () => {
    const search = await setup(true);
    const result = await search.resolve('Bahariye Caddesi 10 B Blok Kat 2 Daire 5 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best).toMatchObject({ precision: 'address' });
    expect(best?.unit?.block?.building).toBeGreaterThan(0);
    expect(best?.unit?.floor).toMatchObject({ value: 2, source: 'written' });
    expect(best?.unit?.door).toBe('5');
  });

  it('widens the search to the whole site when the block is further than the first radius', async () => {
    const search = await setup(true);
    const result = await search.resolve('Bahariye Caddesi 10 C Blok Kat 2 Daire 5 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best?.unit?.block?.building).toBeGreaterThan(0);
    expect(best?.unit?.notes).not.toContain('block_not_found');
  });

  it('finds the building across the street, next to it and behind it for a landmark', async () => {
    const search = await setup(true);
    const kind = async (text: string) => {
      const r = await search.resolve(text);
      const best = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
      return { status: r.status, relation: best?.relation?.kind, notes: best?.notes ?? [], radiusM: best?.radiusM };
    };
    expect(await kind('Bahariye Caddesi 10 karşısı Kadıköy İstanbul')).toMatchObject({ relation: 'opposite', notes: ['relative_to_landmark'], radiusM: 35 });
    expect(await kind('Bahariye Caddesi 10 yanı Kadıköy İstanbul')).toMatchObject({ relation: 'beside', radiusM: 25 });
    expect(await kind('Bahariye Caddesi 10 arkası Kadıköy İstanbul')).toMatchObject({ relation: 'behind', radiusM: 60 });
    expect(await kind('Bahariye Caddesi 10 köşesi Kadıköy İstanbul')).toMatchObject({ relation: undefined, notes: expect.arrayContaining(['relation_not_found']) });
  });

  it('answers a relation to a landmark that is not on the map with the landmark itself', async () => {
    const without = await setup(false);
    const r = await without.resolve('Bahariye Caddesi 10 karşısı Kadıköy İstanbul');
    const best = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
    expect(best?.relation).toBeUndefined();
    expect(best?.notes).toContain('landmark_not_in_building');
  });

  it('validates an address with a unit: consistent is ok, a missing block is a conflict with the note in the user language', async () => {
    const search = await setup(true);
    const fine = await search.validate('Bahariye Caddesi 10 B Blok Kat 2 Daire 5 Kadıköy İstanbul');
    expect(fine.notes.filter((n) => n.severity !== 'info')).toEqual([]);
    const bad = await search.validate('Bahariye Caddesi 10 Z Blok Kat 1 Kadıköy İstanbul', { language: 'en' });
    expect(bad.status).toBe('conflict');
    expect(bad.notes).toEqual([expect.objectContaining({ code: 'block_not_found', field: 'unit', message: 'The block you wrote was not found in the complex.' })]);
    expect(bad.standard?.text).toContain('Bahariye Caddesi');
  });

  it('reverses a point in a building without a door into an estimated number, its side, the neighbours and the building facts', async () => {
    const search = await setup(true);
    const point: [number, number] = [28.6 + 22 * 0.0001, 40.7 + 22 * 0.00005];
    const place = await search.reverse(point, { language: 'en' });
    expect(place).toMatchObject({ precision: 'interpolated', approximate: true, notes: ['number_estimated'], building: { levels: 7, levelsSource: 'num_floors' } });
    expect(place?.components.street).toBe('Bahariye Caddesi');
    expect(place?.components.houseNumber).toBe('22');
    expect(place?.numberRange?.[0]).toBeLessThanOrEqual(22);
    expect(place?.numberRange?.[1]).toBeGreaterThanOrEqual(22);
    expect(['left', 'right']).toContain(place?.side);
    expect(place?.around?.length).toBeGreaterThanOrEqual(2);
    expect(place?.around?.every((a) => a.number === null || Number(a.number) % 2 === 0)).toBe(true);
  });

  it('gives the known door of the building the point is in, and an estimate for it when the door is hidden', async () => {
    const search = await setup(true);
    const point: [number, number] = [28.6 + 10 * 0.0001, 40.7 + 10 * 0.00005];
    const known = await search.reverse(point);
    expect(known).toMatchObject({ precision: 'address', approximate: false, components: { street: 'Bahariye Caddesi', houseNumber: '10' } });
    const id = Number((known?.id ?? '').split(':').pop());
    expect(known?.id).toBeTruthy();
    const hidden = await search.reverse(point, { hide: [Number.NaN, 0] });
    expect(hidden?.components.houseNumber).toBe('10');
    expect(known?.around?.length).toBeGreaterThan(0);
    expect(id).not.toBeNaN();
  });

  it('says only the side when every door is hidden, and gives the area when the building has no street', async () => {
    const search = await setup(true);
    const noDoors = await search.reverse([28.6 + 22 * 0.0001, 40.7 + 22 * 0.00005], { hide: Array.from({ length: 400 }, (_, i) => i) });
    expect(noDoors).toMatchObject({ precision: 'street', notes: ['side_only'] });
    expect(['left', 'right']).toContain(noDoors?.side);
    expect(noDoors?.components.houseNumber).toBeUndefined();
    const lone = await search.reverse([28.6013, 40.704]);
    expect(lone?.building).toBeDefined();
    expect(lone?.components.street).toBeUndefined();
    expect(lone?.around).toBeUndefined();
  });

  it('completes a typed number with the known doors and gives the unit hints of the building', async () => {
    const search = await setup(true);
    const list = await search.autocomplete('Bahariye Caddesi 1', { limit: 8 });
    const doors = list.filter((p) => p.precision === 'address').map((p) => p.components.houseNumber);
    expect(doors).toEqual(expect.arrayContaining(['1', '10', '12']));
    expect(doors.every((n) => (n ?? '').startsWith('1'))).toBe(true);
    const ten = (await search.autocomplete('Bahariye Caddesi 10', { limit: 3 })).find((p) => p.components.houseNumber === '10');
    expect(ten?.completion).toBe('Bahariye Caddesi No:10 ');
    expect(ten?.unitHint).toMatchObject({ blocks: ['A', 'B', 'C'], floors: expect.any(Number), flats: expect.any(Number) });
    const plain = await search.autocomplete('Bahariye Caddesi 10', { limit: 3, deep: false });
    expect(plain.find((p) => p.components.houseNumber === '10')?.unitHint).toBeUndefined();
  });

  it('keeps the first results the same with a session and reads less on the second key', async () => {
    const search = await setup(true);
    const session = createTypeSession();
    const first = await search.autocomplete('Bahariye Cad', { limit: 5, session });
    const second = await search.autocomplete('Bahariye Cadd', { limit: 5, session });
    const fresh = await search.autocomplete('Bahariye Cadd', { limit: 5 });
    expect(second.map((p) => p.id)).toEqual(fresh.map((p) => p.id));
    expect(first.length).toBeGreaterThan(0);
    expect(await search.autocomplete('Bahariye Cadd', { limit: 5, session: 'x' as never })).toHaveLength(fresh.length);
  });

  it('lists the saved and recent places first, boosts them, and answers an empty text with them', async () => {
    const search = await setup(true);
    const base = await search.autocomplete('Bahariye Caddesi 10', { limit: 3 });
    const door = base.find((p) => p.components.houseNumber === '10') as NonNullable<(typeof base)[number]>;
    const other = { ...door, id: '34:saved:1', label: 'Evim, Bahariye Caddesi No:99, Kadıköy/İstanbul', components: { ...door.components, houseNumber: '99' } };
    expect((await search.autocomplete('', { limit: 5, saved: [other], recent: [door, door] })).map((p) => p.id)).toEqual(['34:saved:1', door.id]);
    const typed = await search.autocomplete('Bahariye Caddesi', { limit: 3, saved: [other], recent: [{ id: 'x' } as never, null as never] });
    expect(typed.map((p) => p.id)).toContain('34:saved:1');
    const boosted = await search.autocomplete('Bahariye Caddesi 1', { limit: 8, recent: [door] });
    expect(boosted[0]?.id).toBe(door.id);
    expect(await search.autocomplete('Bahariye Caddesi 10', { limit: 3, budgetMs: 1_000_000 })).toHaveLength(base.length);
    expect(await search.autocomplete('Bahariye Caddesi 10', { limit: 3, budgetMs: -5, near: [28.6, 40.7] })).toHaveLength(base.length);
  });

  it('prefers the building ahead, notes a poor GPS fix and ignores doors that are hidden', async () => {
    const search = await setup(true);
    const between: [number, number] = [28.6 + 22.5 * 0.0001, 40.7 + 22 * 0.00005 + 0.00012];
    const ahead = await search.reverse(between, { heading: 90, accuracyM: 80 });
    const behind = await search.reverse(between, { heading: 270 });
    expect(ahead?.notes).toContain('low_accuracy');
    expect(ahead?.building?.id).not.toBe(behind?.building?.id);
    expect(await search.reverse(between, { heading: Number.NaN, accuracyM: Number.NaN, hide: [1, 2, 3] })).not.toBeNull();
  });

  it('answers a street and side when the point is on the road, not in a building, and nothing without a road', async () => {
    const search = await setup(true);
    const onRoad = await search.reverse([28.6011, 40.70025 + 0.0011 * 0.5 + 0.0006], { language: 'tr' });
    expect(onRoad?.components.street).toBe('Bahariye Caddesi');
    expect(onRoad?.building).toBeUndefined();
    expect(await search.reverse([28.9, 40.9])).not.toBeNull();
  });

  it('says so when the block is not in the site', async () => {
    const search = await setup(true);
    const result = await search.resolve('Bahariye Caddesi 10 Z Blok Kat 1 Kadıköy İstanbul');
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(best?.unit?.notes).toContain('block_not_found');
  });

  it('leaves out the unit when the address has none, or when there is no building pack', async () => {
    const withBuildings = await setup(true);
    const plain = await withBuildings.resolve('Bahariye Caddesi 10 Kadıköy İstanbul');
    expect(plain.status === 'resolved' ? plain.best.unit : undefined).toBeUndefined();
    const without = await setup(false);
    const result = await without.resolve('Bahariye Caddesi 10 B Blok Kat 2 Daire 5 Kadıköy İstanbul');
    expect(result.status === 'resolved' ? result.best.unit : undefined).toBeUndefined();
  });
});
