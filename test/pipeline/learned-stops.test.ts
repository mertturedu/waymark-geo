import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { attachStops } from '../../pipeline/build/learned-stops';
import { prepare, writeBuildingPack, type Trace } from '../../pipeline/build/building-pack-v2';
import type { DeliveryRecord } from '../../pipeline/real/records';
import { openBuildings2 } from '../../src/core/address/buildings2';
import { createSearch } from '../../src/core/address/search';
import type { LngLat } from '../../src/core/geo/cells';
import { distanceM } from '../../src/core/geo/distance';
import type { PackStore, SqlDb } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';
import { moveBy } from '../sim/noise';
import { rng } from '../sim/random';
import { walkFor } from '../sim/walks';
import { part, where } from './helpers/mini-work';
import { richRows } from '../address/helpers/mini-pack';
import { builtPack, turkeyBorders } from '../address/helpers/search-fixture';

const box = (lon: number, lat: number): [number, number][] => [[lon - 0.00004, lat - 0.00003], [lon + 0.00004, lat - 0.00003], [lon + 0.00004, lat + 0.00003], [lon - 0.00004, lat + 0.00003]];
const DOOR: LngLat = [28.6 + 12 * 0.0001, 40.7 + 12 * 0.00005];

describe('attachStops', () => {
  const dbs: SqlDb[] = [];
  afterAll(async () => {
    for (const db of dbs) await db.close();
  });

  async function world() {
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
      traces.push({ id: `b${n}`, lon, lat, area: 120, ring: box(lon, lat), height: null, floors: null, name: null, cls: null, src: null, rec: null });
    }
    const buildingsFile = join(mkdtempSync(join(tmpdir(), 'stops-')), 'buildings2.sqlite');
    writeBuildingPack(buildingsFile, '34', prepare(traces, [{ id, name: 'Bahariye Caddesi', lines: [[[28.6, 40.70025], [28.6026, 40.70155]]] }], new Map()), new Map(), 't');
    const address = openSqlite(file);
    const buildings = openSqlite(buildingsFile);
    dbs.push(address, buildings);
    const store: PackStore = { installed: async () => ['34'], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) };
    return { search: createSearch({ store, borders: turkeyBorders() }), reader: await openBuildings2(buildings) };
  }

  const record = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({ v: 1, src: 'a', week: 2800, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '12', coordSource: 'gps', gps: { lng: DOOR[0], lat: DOOR[1], accuracyM: 8 }, ...over });

  it('turns the trace into the stop at the door, drops the trace and offers an entrance next to the building', async () => {
    const { search, reader } = await world();
    const walk = walkFor(rng(5), { truth: DOOR, tap: 'after' });
    const out = await attachStops([record({ trace: walk.trace, gps: { lng: walk.confirm.point[0], lat: walk.confirm.point[1], accuracyM: walk.confirm.accuracyM } })], search, reader);
    expect(out).toMatchObject({ withStop: 1, noStop: 0, entrances: 1 });
    const first = out.records[0] as DeliveryRecord;
    expect(first.trace).toBeUndefined();
    expect(distanceM([first.stop?.lng as number, first.stop?.lat as number], DOOR)).toBeLessThan(10);
    expect(first.entrance).toEqual(first.stop);
  });

  it('does not offer an entrance without a building pack or when the record has one', async () => {
    const { search } = await world();
    const walk = walkFor(rng(6), { truth: DOOR });
    expect((await attachStops([record({ trace: walk.trace })], search)).entrances).toBe(0);
    const { reader } = await world();
    const given = { lng: DOOR[0] + 0.00001, lat: DOOR[1] };
    const out = await attachStops([record({ trace: walk.trace, entrance: given })], search, reader);
    expect(out.records[0]?.entrance).toEqual(given);
    expect(out.entrances).toBe(0);
  });

  it('removes the trace and adds no stop when the courier never stood near the address', async () => {
    const { search, reader } = await world();
    const far = walkFor(rng(7), { truth: moveBy(DOOR, 500, 0) });
    const moving = Array.from({ length: 8 }, (_, i) => ({ lng: DOOR[0] + i * 0.0003, lat: DOOR[1], accuracyM: 6, speed: 4, t: 30 - i * 3 }));
    const out = await attachStops([record({ trace: far.trace, gps: undefined, pin: { lng: DOOR[0], lat: DOOR[1] }, coordSource: 'pin' }), record({ trace: moving })], search, reader);
    expect(out).toMatchObject({ withStop: 0, noStop: 2 });
    expect(out.records.every((r) => r.trace === undefined && r.stop === undefined)).toBe(true);
  });

  it('leaves records without a trace as they are and reuses the lookup for the same address', async () => {
    const { search, reader } = await world();
    const plain = record();
    const walk = walkFor(rng(8), { truth: DOOR });
    const out = await attachStops([plain, record({ trace: walk.trace }), record({ src: 'b', trace: walkFor(rng(9), { truth: DOOR }).trace })], search, reader);
    expect(out.records[0]).toBe(plain);
    expect(out.withStop).toBe(2);
  });

  it('still finds the stop for a door the map does not have, using the pin and the confirm point', async () => {
    const { search, reader } = await world();
    const missing = moveBy(DOOR, 0, 30);
    const walk = walkFor(rng(10), { truth: missing, tap: 'after' });
    const out = await attachStops([record({ houseNumber: '99', trace: walk.trace, pin: { lng: missing[0], lat: missing[1] }, coordSource: 'pin' })], search, reader);
    expect(out.withStop).toBe(1);
  });
});
