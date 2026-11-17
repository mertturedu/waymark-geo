import { createSearch } from '../../src/core/address/search';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { builtPack, searchRows, square, turkeyBorders } from './helpers/search-fixture';

type Counts = { opens: string[]; releases: string[]; peeks: string[] };

async function rig(plates: string[]): Promise<{ store: PackStore; counts: Counts; clock: { now(): number; sleep(ms: number): Promise<void>; set(ms: number): void }; close(): Promise<void> }> {
  const file = await builtPack(searchRows(), '34');
  const dbs: SqlDb[] = [];
  const counts: Counts = { opens: [], releases: [], peeks: [] };
  const fresh = (): SqlDb => {
    const db = openSqlite(file);
    dbs.push(db);
    return db;
  };
  let time = 0;
  const clock = { now: () => time, sleep: async () => undefined, set: (ms: number) => void (time = ms) };
  const store: PackStore = {
    installed: async () => plates,
    open: async (plate) => {
      counts.opens.push(plate);
      return plates.includes(plate) ? fresh() : null;
    },
    release: (plate) => void counts.releases.push(plate),
    peek: async (plate, run) => {
      counts.peeks.push(plate);
      const db = fresh();
      try {
        return await run(db);
      } finally {
        await db.close();
      }
    },
  };
  return { store, counts, clock, close: async () => void (await Promise.all(dbs.map((db) => db.close().catch(() => undefined)))) };
}

const borders = turkeyBorders();

describe('search memory', () => {
  it('reads neighbourhood names without opening the provinces, and keeps them for the next call', async () => {
    const r = await rig(['34', '35', '06', '16', '20', '41']);
    const search = createSearch({ store: r.store, borders, clock: r.clock });
    const first = await search.hoods(undefined, 'tr');
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first.map((h) => h.region))).toEqual(new Set(['34', '35', '06', '16', '20', '41']));
    expect(r.counts.opens).toEqual([]);
    expect(r.counts.peeks.sort()).toEqual(['06', '16', '20', '34', '35', '41']);
    const again = await search.hoods(undefined, 'en');
    expect(again).toHaveLength(first.length);
    expect(r.counts.peeks).toHaveLength(6);
    search.invalidate('34');
    await search.hoods('34', 'tr');
    expect(r.counts.peeks).toHaveLength(7);
    await r.close();
  });

  it('gives the same names with and without peeking', async () => {
    const r = await rig(['34']);
    const peeking = createSearch({ store: r.store, borders });
    const plain = createSearch({ store: { installed: r.store.installed, open: r.store.open }, borders });
    const a = await peeking.hoods('34', 'tr');
    const b = await plain.hoods('34', 'tr');
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    await r.close();
  });

  const many = turkeyBorders([
    { plate: '35', rings: square(26, 38, 27, 39) },
    { plate: '06', rings: square(32, 39, 33, 40) },
    { plate: '16', rings: square(30.5, 40, 31.5, 41) },
    { plate: '20', rings: square(29, 37, 30, 38) },
  ]);
  const POINT: Record<string, [number, number]> = { '34': [29, 41], '35': [26.5, 38.5], '06': [32.5, 39.5], '16': [31, 40.5], '20': [29.5, 37.5] };
  const touch = async (search: ReturnType<typeof createSearch>, plate: string) => void (await search.coverage(POINT[plate] as [number, number]));

  it('keeps at most four provinces open and lets go of the one used longest ago', async () => {
    const plates = ['34', '35', '06', '16', '20'];
    const r = await rig(plates);
    const search = createSearch({ store: r.store, borders: many, clock: r.clock, maxOpen: 4 });
    for (const plate of ['34', '35', '06', '16']) await touch(search, plate);
    expect(r.counts.releases).toEqual([]);
    await touch(search, '35');
    await touch(search, '20');
    expect(r.counts.releases).toEqual(['34']);
    await touch(search, '34');
    expect(r.counts.releases).toEqual(['34', '06']);
    expect(r.counts.opens.filter((plate) => plate === '35')).toHaveLength(1);
    await r.close();
  });

  it('uses the default of four open provinces', async () => {
    const plates = ['34', '35', '06', '16', '20'];
    const r = await rig(plates);
    const search = createSearch({ store: r.store, borders: many });
    for (const plate of plates) await touch(search, plate);
    expect(r.counts.releases).toEqual(['34']);
    await r.close();
  });

  it('lets go of a province that was idle for two minutes when another one is opened, not before', async () => {
    const r = await rig(['34', '35']);
    const search = createSearch({ store: r.store, borders: many, clock: r.clock });
    r.clock.set(0);
    await touch(search, '34');
    r.clock.set(119_000);
    await touch(search, '35');
    expect(r.counts.releases).toEqual([]);
    r.clock.set(121_000);
    await touch(search, '35');
    expect(r.counts.releases).toEqual(['34']);
    await touch(search, '34');
    expect(r.counts.opens.filter((plate) => plate === '34')).toHaveLength(2);
    await r.close();
  });

  it('does not touch the store when no clock is given and few provinces are open', async () => {
    const r = await rig(['34', '35']);
    const search = createSearch({ store: r.store, borders: many });
    await touch(search, '34');
    await touch(search, '35');
    await touch(search, '34');
    expect(r.counts.releases).toEqual([]);
    expect(r.counts.opens).toEqual(['34', '35']);
    await r.close();
  });
});
