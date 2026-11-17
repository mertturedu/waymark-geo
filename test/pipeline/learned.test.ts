import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layerKeyOf, composeKey } from '../../src/core/learn/key';
import { distanceM } from '../../src/core/geo/distance';
import { floorFromLayout } from '../../src/core/learned/layout';
import { openLearned } from '../../src/core/learned/pack';
import { openSqlite } from '../../src/node/sqlite';
import { buildLearned } from '../../pipeline/build/learned';
import { auditLearned } from '../../pipeline/validate/learned-audit';
import { DatabaseSync } from 'node:sqlite';
import type { DeliveryRecord } from '../../pipeline/real/records';

const HOME: [number, number] = [29.0, 41.0];
const east = (p: [number, number], m: number): [number, number] => [p[0] + m / (111_195 * Math.cos((p[1] * Math.PI) / 180)), p[1]];

const record = (over: Partial<DeliveryRecord> & { src: string }): DeliveryRecord => ({
  v: 1,
  week: 2800,
  region: '34',
  district: 'Kadıköy',
  neighbourhood: 'Caferağa',
  street: 'Moda Caddesi',
  houseNumber: '10',
  coordSource: 'gps',
  gps: { lng: HOME[0], lat: HOME[1], accuracyM: 8 },
  ...over,
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'learned-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const keyOf = (r: DeliveryRecord): string => composeKey(layerKeyOf('34', { district: r.district, neighbourhood: r.neighbourhood, street: r.street, houseNumber: r.houseNumber }) as NonNullable<ReturnType<typeof layerKeyOf>>);

async function read(file: string) {
  const db = await openSqlite(file);
  return { db, pack: (await openLearned(db)) as NonNullable<Awaited<ReturnType<typeof openLearned>>> };
}

describe('buildLearned', () => {
  it('trusts two independent sources that agree', async () => {
    const out = join(dir, 'l.sqlite');
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record({ src: 'a' }), record({ src: 'b', gps: { lng: east(HOME, 6)[0], lat: HOME[1], accuracyM: 9 } })] });
    expect(stats).toMatchObject({ keys: 1, trusted: 1 });
    const { db, pack } = await read(out);
    const hit = await pack.lookup(layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '10' }) as never);
    expect(hit?.trusted).toBe(true);
    expect(distanceM(hit?.coordinate as never, HOME)).toBeLessThan(6);
    await db.close();
  });

  it('keeps a single delivery untrusted and a pin with a close gps trusted', async () => {
    const solo = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'a.sqlite'), records: [record({ src: 'a' })] });
    expect(solo).toMatchObject({ trusted: 0, untrusted: 1 });
    const both = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'b.sqlite'), records: [record({ src: 'a', pin: { lng: east(HOME, 10)[0], lat: HOME[1] } })] });
    expect(both).toMatchObject({ trusted: 1 });
  });

  it('drops points further than 50 m from the consensus', async () => {
    const records = [record({ src: 'a' }), record({ src: 'b' }), record({ src: 'c', gps: { lng: east(HOME, 200)[0], lat: HOME[1], accuracyM: 10 } })];
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records });
    expect(stats.outlierPoints).toBe(1);
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const hit = await pack.lookup(layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '10' }) as never);
    expect(distanceM(hit?.coordinate as never, HOME)).toBeLessThan(1);
    await db.close();
  });

  it('lets a learned point beat OSM only with three sources', async () => {
    const far = east(HOME, 60);
    const two = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'a.sqlite'), osmPoint: () => far, records: [record({ src: 'a' }), record({ src: 'b' })] });
    expect(two).toMatchObject({ trusted: 0, conflictsKept: 1 });
    const three = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'b.sqlite'), osmPoint: () => far, records: [record({ src: 'a' }), record({ src: 'b' }), record({ src: 'c' })] });
    expect(three).toMatchObject({ trusted: 1, conflictsWon: 1 });
  });

  it('lets recent records outweigh old ones', async () => {
    const newer = east(HOME, 30);
    const records = [record({ src: 'a', week: 2600 }), record({ src: 'b', week: 2800, gps: { lng: newer[0], lat: newer[1], accuracyM: 8 } })];
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records });
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const hit = await pack.lookup(layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '10' }) as never);
    expect(distanceM(hit?.coordinate as never, newer)).toBeLessThan(distanceM(hit?.coordinate as never, HOME));
    await db.close();
  });

  it('learns the floor layout of a building from floor and door pairs', async () => {
    const pairs: [string, string, string][] = [['a', '0', '2'], ['b', '1', '5'], ['c', '2', '9'], ['a', '3', '14'], ['b', '1', '7'], ['c', '2', '11'], ['a', '0', '1']];
    const records = pairs.map(([src, floor, door]) => record({ src, floor, door }));
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records });
    expect(stats.layouts).toBe(1);
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const layout = await pack.layout(keyOf(records[0] as DeliveryRecord));
    expect(layout?.samples).toBe(7);
    expect(floorFromLayout(layout as never, 12)?.source).toBe('learned');
    await db.close();
  });

  it('requires two independent sources for a layout and for entrances', async () => {
    const solo = [record({ src: 'a', floor: '1', door: '4' }), record({ src: 'a', floor: '2', door: '8' }), record({ src: 'a', floor: '3', door: '12' }), record({ src: 'a', entrance: { lng: HOME[0], lat: HOME[1] } })];
    expect(await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: solo })).toMatchObject({ layouts: 0, entrances: 0 });
  });

  it('clusters entrances from different sources', async () => {
    const a = east(HOME, 3);
    const records = [record({ src: 'a', entrance: { lng: HOME[0], lat: HOME[1] } }), record({ src: 'b', entrance: { lng: a[0], lat: a[1] } }), record({ src: 'c', entrance: { lng: east(HOME, 80)[0], lat: HOME[1] } })];
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records });
    expect(stats.entrances).toBe(1);
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const found = await pack.entrances(keyOf(records[0] as DeliveryRecord));
    expect(found).toHaveLength(1);
    expect(found[0]?.sources).toBe(2);
    await db.close();
  });

  it('turns three agreeing records of an unknown street into a name hint', async () => {
    const records = ['a', 'b', 'c'].map((src, i) => record({ src, street: 'Yeni Çıkmaz Sokak', houseNumber: String(i + 1), gps: { lng: east(HOME, i * 5)[0], lat: HOME[1], accuracyM: 8 } }));
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), streetKnown: () => false, records });
    expect(stats.hints).toBe(1);
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const hints = await pack.hints('kadikoy');
    expect(hints[0]).toMatchObject({ name: 'Yeni Çıkmaz Sokak', sources: 3 });
    await db.close();
  });

  it('stores a street line with door samples next to an extra hint and reads it back', async () => {
    const way = { line: [[29, 41], [29.001, 41]] as [number, number][], doors: [[1, 10], [3, 40], [5, 70], [7, 100]] as [number, number][] };
    const extraHints = [{ district: 'kadikoy', name: 'Yeni Sokağı', point: [29.0005, 41] as [number, number], radiusM: 120, sources: 6, way }, { district: 'kadikoy', name: 'Eski Sokağı', point: [29.002, 41] as [number, number], radiusM: 200, sources: 2 }];
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: [], extraHints });
    expect(stats.hints).toBe(2);
    const { db, pack } = await read(join(dir, 'l.sqlite'));
    const hints = await pack.hints('kadikoy');
    expect(hints.find((h) => h.name === 'Yeni Sokağı')?.way).toEqual(way);
    expect(hints.find((h) => h.name === 'Eski Sokağı')?.way).toBeUndefined();
    await db.close();
  });

  it('marks a hint with its origin and leaves the origin out on request', async () => {
    const extraHints = [{ district: 'kadikoy', name: 'Yeni Sokağı', point: [29.0005, 41] as [number, number], radiusM: 120, sources: 1, origin: 1 }, { district: 'kadikoy', name: 'Eski Sokağı', point: [29.002, 41] as [number, number], radiusM: 200, sources: 2 }];
    const withAll = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'all.sqlite'), records: [], extraHints });
    const without = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'none.sqlite'), records: [], extraHints, withoutOrigin: [1] });
    expect([withAll.hints, without.hints]).toEqual([2, 1]);
    const raw = new DatabaseSync(join(dir, 'all.sqlite'), { readOnly: true });
    expect(raw.prepare('SELECT name, origin FROM hint ORDER BY name').all()).toEqual([{ name: 'Eski Sokağı', origin: 0 }, { name: 'Yeni Sokağı', origin: 1 }]);
    raw.close();
    expect(auditLearned(join(dir, 'all.sqlite')).errors).toEqual([]);
    const bad = new DatabaseSync(join(dir, 'all.sqlite'));
    bad.prepare('UPDATE hint SET origin = 7 WHERE name = ?').run('Yeni Sokağı');
    bad.close();
    expect(auditLearned(join(dir, 'all.sqlite')).errors.join(' ')).toContain('origin');
  });

  it('adds an extra door as untrusted with its origin, never over a delivered door, and drops it on request', async () => {
    const delivered = layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '5' });
    const key = composeKey(delivered!);
    const extraDoors = [{ key: composeKey(layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '9' })!), point: [29.001, 41.001] as [number, number], origin: 1 }, { key, point: [29.5, 41.5] as [number, number], origin: 1 }];
    const at = { neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '5' };
    const records = [record({ src: 'a', week: 2799, ...at }), record({ src: 'b', week: 2799, ...at })];
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'd1.sqlite'), records, extraDoors });
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'd2.sqlite'), records, extraDoors, withoutOrigin: [1] });
    const rows = (file: string): { key: string; trusted: number; origin: number }[] => {
      const db = new DatabaseSync(join(dir, file), { readOnly: true });
      const out = db.prepare('SELECT key, trusted, origin FROM door ORDER BY key').all() as { key: string; trusted: number; origin: number }[];
      db.close();
      return out;
    };
    expect(rows('d1.sqlite').filter((r) => r.origin === 1)).toEqual([{ key: extraDoors[0]!.key, trusted: 0, origin: 1 }]);
    expect(rows('d2.sqlite').some((r) => r.origin === 1)).toBe(false);
    expect(auditLearned(join(dir, 'd1.sqlite')).errors).toEqual([]);
  });

  it('is deterministic and stores no person or time', async () => {
    const records = [record({ src: 'secret-courier-1', week: 2790 }), record({ src: 'secret-courier-2', week: 2799 })];
    const one = join(dir, 'one.sqlite');
    const two = join(dir, 'two.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: one, records });
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: two, records: [...records].reverse() });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(one).equals(readFileSync(two))).toBe(true);
    expect(readFileSync(one).includes(Buffer.from('secret-courier'))).toBe(false);
  });

  it('ignores records of other provinces', async () => {
    expect((await buildLearned({ plate: '06', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: [record({ src: 'a' })] })).keys).toBe(0);
  });
});

describe('auditLearned', () => {
  it('passes a freshly built part', async () => {
    const out = join(dir, 'l.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record({ src: 'a' }), record({ src: 'b' })] });
    expect(auditLearned(out, '34', [28, 40, 30, 42]).errors).toEqual([]);
  });

  it('flags a part with a person or time column', async () => {
    const out = join(dir, 'l.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record({ src: 'a' })] });
    const db = new DatabaseSync(out);
    db.exec('ALTER TABLE door ADD COLUMN courier TEXT');
    db.close();
    expect(auditLearned(out, '34').errors.join(' ')).toContain('kişi ya da zaman alanı');
  });

  it('flags personal data in keys, a wrong province and points outside the region', async () => {
    const out = join(dir, 'l.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record({ src: 'a' }), record({ src: 'b' })] });
    const db = new DatabaseSync(out);
    db.prepare('INSERT INTO hint (district, name, lng, lat, radius, sources) VALUES (?, ?, ?, ?, ?, ?)').run('kadikoy', 'Ali 05321234567', 29_000_000, 41_000_000, 40, 3);
    db.close();
    const errors = auditLearned(out, '06', [32, 39, 33, 40]).errors.join(' | ');
    expect(errors).toContain('il uyuşmuyor');
    expect(errors).toContain('telefon');
    expect(errors).toContain('bölgenin dışında');
  });
});

describe('the point rule: stop over pin over confirm GPS', () => {
  const near = east(HOME, 8);
  const lookup = async (file: string) => {
    const { db, pack } = await read(file);
    const hit = await pack.lookup(layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '10' }) as never);
    await db.close();
    return hit;
  };

  it('takes the stop and ignores the confirm gps when there is one', async () => {
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: [record({ src: 'a', gps: { lng: east(HOME, 40)[0], lat: HOME[1], accuracyM: 8 }, stop: { lng: HOME[0], lat: HOME[1] } })] });
    expect(stats).toMatchObject({ stopsUsed: 1, pinsDroppedForStop: 0 });
    expect(distanceM((await lookup(join(dir, 'l.sqlite')))?.coordinate as never, HOME)).toBeLessThan(0.5);
  });

  it('drops a pin that is far from the stop and keeps the stop alone untrusted', async () => {
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: [record({ src: 'a', coordSource: 'pin', pin: { lng: east(HOME, 90)[0], lat: HOME[1] }, stop: { lng: HOME[0], lat: HOME[1] } })] });
    expect(stats).toMatchObject({ stopsUsed: 1, pinsDroppedForStop: 1, trusted: 0 });
    expect(distanceM((await lookup(join(dir, 'l.sqlite')))?.coordinate as never, HOME)).toBeLessThan(0.5);
  });

  it('trusts a stop that a nearby pin confirms and pulls the point toward the stop', async () => {
    const stats = await buildLearned({ plate: '34', nowWeek: 2800, outFile: join(dir, 'l.sqlite'), records: [record({ src: 'a', coordSource: 'pin', pin: { lng: near[0], lat: near[1] }, stop: { lng: HOME[0], lat: HOME[1] } })] });
    expect(stats).toMatchObject({ trusted: 1, pinsDroppedForStop: 0 });
    const at = (await lookup(join(dir, 'l.sqlite')))?.coordinate as never;
    expect(distanceM(at, HOME)).toBeLessThan(distanceM(at, near));
  });

  it('never lets a trace reach the pack, whatever it holds', async () => {
    const sentinel = 41.123456;
    const trace = [{ lng: 29.123456, lat: sentinel, accuracyM: 7, speed: 0.1, t: 12 }];
    const out = join(dir, 'l.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record({ src: 'a', trace }), record({ src: 'b', trace })] });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(out).includes(Buffer.from('29.123456'))).toBe(false);
    expect(auditLearned(out, '34').errors).toEqual([]);
  });
});
