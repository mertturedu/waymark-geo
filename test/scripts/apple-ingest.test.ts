import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LngLat } from '../../src/core/geo/cells';
import { wayPoint } from '../../src/core/learned/way';
import { addApple, appleHintsOf, directoryStreets, appleWaysOf, applyWays, dropSpikes, wayHintOf, APPLE_HINT_RADIUS_M } from '../../scripts/apple-ingest';
import type { Judged } from '../../scripts/apple-judge';
import type { AppleQuery } from '../../scripts/apple-queries';

const query = (over: Partial<AppleQuery> = {}): AppleQuery => ({ id: 'q-34-000', plate: '34', set: 'eksik', text: 'Yeni Sokak No:5 Kadıköy İstanbul', district: 'Kadıköy', center: null, hood: null, street: 'YENİ SOKAK', number: '5', truth: null, ours: { status: 'resolved', level: 'ilçe', source: 'derived', precision: 'district', approximate: true, coordinate: [29, 41] }, ...over });
const judged = (over: Partial<Judged> = {}): Judged => ({ id: 'q-34-000', plate: '34', set: 'eksik', cls: 'apple', tier: 'A', grain: 'door', why: [], apple: { point: [29.0123456, 41.0234567] as LngLat, radiusM: 70, thoroughfare: 'Yeni Sk.', subThoroughfare: '5', name: 'Yeni Sk. 5', subLocality: null, category: null }, oursLevel: 'ilçe', apart: 5000, errApple: null, errOurs: null, ...over });

describe('appleHintsOf', () => {
  it('turns an Apple-better missing street into an approximate hint marked as Apple', () => {
    const [hint] = appleHintsOf([query()], [judged()]);
    expect(hint).toEqual({ district: 'kadikoy', name: 'Yeni Sokak', point: [29.012346, 41.023457], radiusM: APPLE_HINT_RADIUS_M, sources: 2, origin: 1 });
  });

  it('skips everything that is not a clean Apple-better street answer', () => {
    const q = [query(), query({ id: 'q-34-001', set: 'kapi' }), query({ id: 'q-34-002' }), query({ id: 'q-34-003' }), query({ id: 'q-34-004' })];
    const j = [judged({ cls: 'ayni' }), judged({ id: 'q-34-001', set: 'kapi' }), judged({ id: 'q-34-002', tier: 'C' }), judged({ id: 'q-34-003', why: ['kismi-ad'] }), judged({ id: 'q-34-004', grain: 'area' })];
    expect(appleHintsOf(q, j)).toEqual([]);
  });

  it('keeps the stronger answer when one street is asked twice', () => {
    const q = [query(), query({ id: 'q-34-001' })];
    const [hint] = appleHintsOf(q, [judged({ tier: 'B' }), judged({ id: 'q-34-001', tier: 'A' })]);
    expect(hint?.sources).toBe(2);
  });
});

describe('addApple', () => {
  const own = { district: 'kadikoy', name: 'Yeni Sokağı', point: [29, 41] as LngLat, radiusM: 100, sources: 3 };
  it('never replaces a hint we already have', () => {
    const apple = { ...own, point: [29.5, 41.5] as LngLat, origin: 1 };
    const out = addApple([own], [apple, { ...apple, name: 'Başka Sokak' }]);
    expect(out).toMatchObject({ added: 1, skipped: 1 });
    expect(out.hints.find((h) => h.name === 'Yeni Sokağı')?.point).toEqual([29, 41]);
  });

  it('skips a street the directory already knows in the district, since that name was left out for being in several neighbourhoods', () => {
    const apple = { ...own, name: 'Çok Mahalleli Sokak', point: [29.5, 41.5] as LngLat, origin: 1 };
    const out = addApple([], [apple, { ...apple, name: 'Tek Sokak' }], new Set(['kadikoy|cok mahalleli']));
    expect(out).toMatchObject({ added: 1, skipped: 1 });
    expect(out.hints.map((h) => h.name)).toEqual(['Tek Sokak']);
  });
});

describe('Apple street lines', () => {
  const door = (number: number, lng: number): { number: number; point: LngLat } => ({ number, point: [lng, 41] });
  const street = [door(2, 29), door(20, 29.001), door(40, 29.002), door(60, 29.003), door(80, 29.004)];

  it('builds a line and door samples that place a number along the street', () => {
    const hint = wayHintOf('kadikoy', 'Yeni Sokak', street)!;
    expect(hint).toMatchObject({ origin: 1, sources: 5 });
    expect(hint.way!.doors.map((d) => d[0])).toEqual([2, 20, 40, 60, 80]);
    const at = wayPoint(hint.way!, 30)!;
    expect(at[0]).toBeGreaterThan(29.001);
    expect(at[0]).toBeLessThan(29.002);
  });

  it('needs four doors and drops a point far from its neighbours', () => {
    expect(wayHintOf('kadikoy', 'Yeni Sokak', street.slice(0, 3))).toBeNull();
    const spiked = [...street.slice(0, 2), door(30, 29.2), ...street.slice(2)].sort((a, b) => a.number - b.number);
    expect(dropSpikes(spiked).map((d) => d.number)).toEqual([2, 20, 40, 60, 80]);
  });

  it('takes door answers of tier A or B only and groups them by street', () => {
    const queries: AppleQuery[] = street.map((d, i) => query({ id: `w-${i}`, set: 'yol', number: String(d.number) }));
    const answer = (i: number, over: Partial<Judged> = {}): Judged => judged({ id: `w-${i}`, set: 'yol', tier: 'B', grain: 'door', apple: { ...judged().apple!, point: street[i]!.point }, ...over });
    expect(appleWaysOf(queries, street.map((_, i) => answer(i)))).toHaveLength(1);
    expect(appleWaysOf(queries, street.map((_, i) => answer(i, i < 2 ? { tier: 'C' } : {})))).toEqual([]);
  });

  it('replaces a nearby area hint, adds a new street, and leaves a street that already has a line', () => {
    const way = wayHintOf('kadikoy', 'Yeni Sokak', street)!;
    const near = { district: 'kadikoy', name: 'Yeni Sokağı', point: [29.002, 41.0005] as LngLat, radiusM: 400, sources: 3 };
    expect(applyWays([near], [way])).toMatchObject({ replaced: 1, added: 0, conflicts: 0 });
    expect(applyWays([], [way])).toMatchObject({ replaced: 0, added: 1 });
    expect(applyWays([{ ...near, way: way.way }], [way])).toMatchObject({ conflicts: 1 });
    expect(applyWays([{ ...near, point: [30, 42] }], [way])).toMatchObject({ conflicts: 1 });
  });
});

describe('directoryStreets', () => {
  it('returns nothing for a missing file and the district and street keys of a directory pack', () => {
    expect(directoryStreets('/nonexistent/directory.sqlite').size).toBe(0);
    const file = join(mkdtempSync(join(tmpdir(), 'dir-')), 'directory.sqlite');
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE district (id INTEGER PRIMARY KEY, key TEXT); CREATE TABLE street_name (id INTEGER PRIMARY KEY, key TEXT); CREATE TABLE address (id INTEGER PRIMARY KEY, street_id INTEGER, district_id INTEGER); INSERT INTO district VALUES (1, 'kadikoy'); INSERT INTO street_name VALUES (1, 'yeni'); INSERT INTO address VALUES (1, 1, 1), (2, 1, 1);");
    db.close();
    expect([...directoryStreets(file)]).toEqual(['kadikoy|yeni']);
  });
});
