import { buildBuildingPack } from '../../pipeline/build/building-pack';
import { CLAIM_M, openBuildings, type Doors } from '../../src/core/address/buildings';
import { openRegion } from '../../src/core/address/pack';
import { distanceM } from '../../src/core/geo/distance';
import type { SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { buildingSetup, east } from '../pipeline/helpers/building-fixture';

const here: [number, number] = [28.6035, 40.7001];
const free = [
  { id: 'w100', lon: here[0], lat: here[1] },
  { id: 'w101', lon: east(here[0], here[1], 20)[0], lat: here[1] },
  { id: 'w102', lon: 28.6036, lat: 40.7004 },
];

let db: SqlDb;
let packDb: SqlDb;
let doors: Doors;
let idOf: (number: string) => Promise<number>;

async function open(list = free): Promise<{ db: SqlDb; packDb: SqlDb; doors: Doors; idOf: (n: string) => Promise<number> }> {
  const { work, pack, out } = await buildingSetup(true, list);
  await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' });
  const addressDb = openSqlite(pack);
  const region = await openRegion(addressDb);
  return { db: openSqlite(out), packDb: addressDb, doors: (cells) => region.addressesInCells(cells), idOf: async (n) => (await addressDb.all<{ id: number }>('SELECT id FROM address WHERE number = ?', [n]))[0]?.id as number };
}

beforeAll(async () => {
  ({ db, packDb, doors, idOf } = await open());
});

afterAll(async () => {
  await db.close();
  await packDb.close();
});

describe('openBuildings', () => {
  it('gives the centre of the nearest free building inside thirty metres', async () => {
    const snap = await openBuildings(db, doors);
    const found = await snap(east(here[0], here[1], 4));
    expect(found).not.toBeNull();
    expect(distanceM(found as [number, number], here)).toBeLessThan(0.2);
  });

  it('prefers the nearer of two buildings', async () => {
    const snap = await openBuildings(db, doors);
    expect(distanceM((await snap(east(here[0], here[1], 15))) as [number, number], east(here[0], here[1], 20))).toBeLessThan(0.2);
  });

  it('gives nothing when no building is within thirty metres', async () => {
    const snap = await openBuildings(db, doors);
    expect(await snap([28.65, 40.75])).toBeNull();
    expect(await snap(east(28.6035, 40.7001, 200))).toBeNull();
  });

  it('keeps the point to a metre or better after packing', async () => {
    const snap = await openBuildings(db, doors);
    for (const f of free) expect(distanceM((await snap([f.lon, f.lat])) as [number, number], [f.lon, f.lat])).toBeLessThan(1);
  });

  it('skips a building that already has a door of its own, unless that door is left out', async () => {
    const snap = await openBuildings(db, doors);
    const centre: [number, number] = [28.6, 40.7002];
    const near = east(centre[0], centre[1], 5);
    expect(CLAIM_M).toBe(12);
    expect(await snap(near)).toBeNull();
    const found = await snap(near, new Set([await idOf('2')]));
    expect(distanceM(found as [number, number], centre)).toBeLessThan(0.2);
  });

  it('takes a building 11 m from a door as taken and one 13 m from it as free', async () => {
    const door: [number, number] = [28.6, 40.7002];
    const a = await open([{ id: 'w300', lon: east(door[0], door[1], 11)[0], lat: door[1] }, { id: 'w301', lon: east(28.605, door[1], 13)[0], lat: door[1] }]);
    const snap = await openBuildings(a.db, a.doors);
    expect(await snap(east(door[0], door[1], 11))).toBeNull();
    expect(await snap(east(28.605, door[1], 13))).not.toBeNull();
    await a.db.close();
    await a.packDb.close();
  });

  it('reaches a building across a cell border', async () => {
    const a = await open([{ id: 'w200', lon: 28.60399, lat: 40.70005 }]);
    const snap = await openBuildings(a.db, a.doors);
    expect(await snap([28.60401, 40.70005])).not.toBeNull();
    await a.db.close();
    await a.packDb.close();
  });

  it('takes the southern one of two buildings that are equally near', async () => {
    const a = await open([{ id: 'w500', lon: 28.6055, lat: 40.70035 }, { id: 'w501', lon: 28.6055, lat: 40.70005 }]);
    const snap = await openBuildings(a.db, a.doors);
    const found = (await snap([28.6055, 40.7002])) as [number, number];
    expect(found[1]).toBeCloseTo(40.70005, 6);
    const west = await open([{ id: 'w502', lon: 28.6057, lat: 40.7002 }, { id: 'w503', lon: 28.6053, lat: 40.7002 }]);
    const snapWest = await openBuildings(west.db, west.doors);
    const foundWest = (await snapWest([28.6055, 40.7002])) as [number, number];
    expect(foundWest[0]).toBeCloseTo(28.6053, 6);
    for (const x of [a, west]) {
      await x.db.close();
      await x.packDb.close();
    }
  });

  it('refuses a file of another format', async () => {
    const wrong: SqlDb = { all: async (sql) => (sql.includes('FROM meta') ? [{ k: 'format', v: '9' }] : []) as never, close: async () => undefined };
    await expect(openBuildings(wrong, doors)).rejects.toThrow(/desteklenmeyen bina paketi biçimi: 9/);
  });
});
