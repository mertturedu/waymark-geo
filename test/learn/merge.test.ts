import fc from 'fast-check';
import { distanceM } from '../../src/core/geo/distance';
import { mergeConfirmations, OUTLIER_M, TRUST_SPREAD_M } from '../../src/core/learn/merge';
import type { Confirmation, ConfirmSource } from '../../src/core/learn/types';

const BASE: [number, number] = [29, 41];
const M = 111_195;

const at = (dx: number, dy: number, extra: Partial<Confirmation> = {}): Confirmation => ({
  source: 'delivery', lng: BASE[0] + dx / (M * Math.cos((41 * Math.PI) / 180)), lat: BASE[1] + dy / M, accuracyM: 10, at: 1000, ...extra,
});

const away = (m: Confirmation, target: Confirmation): number => distanceM([m.lng, m.lat], [target.lng, target.lat]);

describe('mergeConfirmations', () => {
  it('has nothing to say about an empty list', () => {
    expect(mergeConfirmations([])).toBeNull();
  });

  it('trusts a single pin and keeps its point', () => {
    const pin = at(0, 0, { source: 'pin' });
    const merged = mergeConfirmations([pin]);
    expect(merged).toMatchObject({ trusted: true, count: 1, used: 1, outliers: [], spreadM: 0 });
    expect(merged?.coordinate).toEqual([pin.lng, pin.lat]);
  });

  it('trusts a single manual point like a pin', () => {
    expect(mergeConfirmations([at(0, 0, { source: 'manual' })])?.trusted).toBe(true);
  });

  it('does not trust a single delivery', () => {
    expect(mergeConfirmations([at(0, 0)])?.trusted).toBe(false);
  });

  it('averages two close deliveries and trusts them', () => {
    const merged = mergeConfirmations([at(0, 0), at(10, 0)]);
    expect(merged?.trusted).toBe(true);
    expect(merged?.used).toBe(2);
    expect(merged?.spreadM).toBeCloseTo(5, 1);
    expect(distanceM(merged?.coordinate as [number, number], [at(5, 0).lng, at(5, 0).lat])).toBeLessThan(0.01);
  });

  it('does not trust two deliveries that are further than the spread allows', () => {
    expect(mergeConfirmations([at(0, 0), at(2 * TRUST_SPREAD_M + 2, 0)])?.trusted).toBe(false);
    expect(mergeConfirmations([at(0, 0), at(2 * TRUST_SPREAD_M - 2, 0)])?.trusted).toBe(true);
  });

  it('weights a sharper fix more', () => {
    const sharp = at(0, 0, { accuracyM: 5 });
    const merged = mergeConfirmations([sharp, at(40, 0, { accuracyM: 50 })]);
    expect(away(sharp, { ...sharp, lng: (merged?.coordinate as [number, number])[0], lat: (merged?.coordinate as [number, number])[1] })).toBeLessThan(1);
  });

  it('treats a missing, zero, negative or non-finite accuracy as unknown', () => {
    const base = mergeConfirmations([at(0, 0, { accuracyM: undefined }), at(20, 0)]);
    for (const bad of [0, -4, Infinity, NaN]) expect(mergeConfirmations([at(0, 0, { accuracyM: bad }), at(20, 0)])?.coordinate).toEqual(
      mergeConfirmations([at(0, 0, { accuracyM: 15 }), at(20, 0)])?.coordinate,
    );
    expect(base?.used).toBe(2);
  });

  it('keeps the heavier of two far deliveries and reports the other as an outlier', () => {
    const heavy = at(0, 0, { accuracyM: 6 });
    const merged = mergeConfirmations([at(120, 0, { accuracyM: 30 }), heavy]);
    expect(merged).toMatchObject({ used: 1, outliers: [0], trusted: false });
    expect(merged?.coordinate).toEqual([heavy.lng, heavy.lat]);
  });

  it('breaks a weight tie between two far deliveries by the newer one', () => {
    const old = at(0, 0, { at: 100 });
    const fresh = at(150, 0, { at: 200 });
    expect(mergeConfirmations([old, fresh])?.coordinate).toEqual([fresh.lng, fresh.lat]);
    expect(mergeConfirmations([fresh, old])?.coordinate).toEqual([fresh.lng, fresh.lat]);
  });

  it('drops a 300 m outlier and returns exactly what the two clean points give', () => {
    const clean = [at(0, 0), at(12, 5)];
    const dirty = mergeConfirmations([clean[0] as Confirmation, at(300, 40), clean[1] as Confirmation]);
    expect(dirty?.outliers).toEqual([1]);
    expect(dirty?.used).toBe(2);
    expect(dirty?.coordinate).toEqual(mergeConfirmations(clean)?.coordinate);
    expect(dirty?.trusted).toBe(true);
  });

  it('keeps three agreeing points as they are', () => {
    const merged = mergeConfirmations([at(0, 0), at(10, 0), at(5, 8)]);
    expect(merged?.outliers).toEqual([]);
    expect(merged?.used).toBe(3);
  });

  it('falls back to the heaviest point when three points all disagree', () => {
    const lead = at(0, 0, { accuracyM: 5 });
    const merged = mergeConfirmations([at(120, 0), lead, at(60, 104)]);
    expect(merged?.used).toBe(1);
    expect(merged?.outliers).toEqual([0, 2]);
    expect(merged?.coordinate).toEqual([lead.lng, lead.lat]);
  });

  it('lets a pin outweigh several deliveries pulling elsewhere', () => {
    const pin = at(0, 0, { source: 'pin', accuracyM: undefined });
    const merged = mergeConfirmations([pin, at(90, 0), at(95, 5), at(92, -4)]);
    expect(merged?.trusted).toBe(true);
    expect(merged?.outliers.sort()).toEqual([1, 2, 3]);
  });

  it('picks between equally heavy far points by time, then by position', () => {
    const west = at(0, 0, { at: 500 });
    const east = at(120, 0, { at: 500 });
    expect(mergeConfirmations([west, east])?.coordinate).toEqual([east.lng, east.lat]);
    expect(mergeConfirmations([east, west])?.coordinate).toEqual([east.lng, east.lat]);
    const south = at(0, 0, { at: 500 });
    const north = at(0, 120, { at: 500 });
    expect(mergeConfirmations([south, north])?.coordinate).toEqual([north.lng, north.lat]);
    expect(mergeConfirmations([north, south])?.coordinate).toEqual([north.lng, north.lat]);
    const same = at(0, 0, { at: 500 });
    expect(mergeConfirmations([same, same])?.coordinate).toEqual([same.lng, same.lat]);
  });

  it('measures the distance of two points the same way in both axes and anywhere on the map', () => {
    expect(mergeConfirmations([at(500, 0), at(530, 0)])?.used).toBe(2);
    expect(mergeConfirmations([at(0, 500), at(0, 530)])?.used).toBe(2);
    expect(mergeConfirmations([at(-500, 0), at(-470, 0)])?.used).toBe(2);
    expect(mergeConfirmations([at(0, 0), at(0, 49)])?.used).toBe(2);
    expect(mergeConfirmations([at(0, 0), at(0, 51)])?.used).toBe(1);
    expect(mergeConfirmations([at(0, 0), at(49, 0)])?.used).toBe(2);
    expect(mergeConfirmations([at(0, 0), at(51, 0)])?.used).toBe(1);
  });

  it('puts the limits where the plan says', () => {
    expect(OUTLIER_M).toBe(50);
    expect(TRUST_SPREAD_M).toBe(25);
  });
});

const confirmation = fc.record({
  source: fc.constantFrom<ConfirmSource>('pin', 'delivery', 'manual'),
  dx: fc.double({ min: -400, max: 400, noNaN: true }),
  dy: fc.double({ min: -400, max: 400, noNaN: true }),
  accuracyM: fc.option(fc.double({ min: 1, max: 80, noNaN: true }), { nil: undefined }),
  at: fc.integer({ min: 1, max: 100000 }),
}).map((r) => at(r.dx, r.dy, { source: r.source, accuracyM: r.accuracyM, at: r.at }));

describe('mergeConfirmations properties', () => {
  it('does not depend on the order of the confirmations', () => {
    fc.assert(
      fc.property(fc.array(confirmation, { minLength: 1, maxLength: 8 }), fc.integer(), (list, seed) => {
        const shuffled = [...list].sort((a, b) => ((a.at * 31 + seed) % 7) - ((b.at * 31 + seed) % 7));
        const a = mergeConfirmations(list);
        const b = mergeConfirmations(shuffled);
        expect(distanceM(a?.coordinate as [number, number], b?.coordinate as [number, number])).toBeLessThan(0.001);
        expect(a?.trusted).toBe(b?.trusted);
        expect(a?.used).toBe(b?.used);
      }),
    );
  });

  it('moves with the data when every point is shifted', () => {
    fc.assert(
      fc.property(fc.array(confirmation, { minLength: 1, maxLength: 6 }), fc.double({ min: -0.01, max: 0.01, noNaN: true }), fc.double({ min: -0.01, max: 0.01, noNaN: true }), (list, dx, dy) => {
        const shifted = list.map((c) => ({ ...c, lng: c.lng + dx, lat: c.lat + dy }));
        const a = mergeConfirmations(list);
        const b = mergeConfirmations(shifted);
        const expected: [number, number] = [(a?.coordinate as [number, number])[0] + dx, (a?.coordinate as [number, number])[1] + dy];
        expect(distanceM(b?.coordinate as [number, number], expected)).toBeLessThan(0.2);
        expect(b?.used).toBe(a?.used);
      }),
    );
  });

  it('accounts for every confirmation and stays inside the points it was given', () => {
    fc.assert(
      fc.property(fc.array(confirmation, { minLength: 1, maxLength: 10 }), (list) => {
        const merged = mergeConfirmations(list);
        expect((merged?.used ?? 0) + (merged?.outliers.length ?? 0)).toBe(list.length);
        const lngs = list.map((c) => c.lng);
        const lats = list.map((c) => c.lat);
        expect(merged?.coordinate[0]).toBeGreaterThanOrEqual(Math.min(...lngs) - 1e-9);
        expect(merged?.coordinate[0]).toBeLessThanOrEqual(Math.max(...lngs) + 1e-9);
        expect(merged?.coordinate[1]).toBeGreaterThanOrEqual(Math.min(...lats) - 1e-9);
        expect(merged?.coordinate[1]).toBeLessThanOrEqual(Math.max(...lats) + 1e-9);
      }),
    );
  });

  it('is not pulled out of a clean cluster by one far point', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.double({ min: -8, max: 8, noNaN: true }), fc.double({ min: -8, max: 8, noNaN: true })), { minLength: 2, maxLength: 5 }), fc.double({ min: 120, max: 400, noNaN: true }), fc.double({ min: 0, max: 6.28, noNaN: true }), (cluster, r, angle) => {
        const clean = cluster.map(([x, y]) => at(x, y));
        const base = mergeConfirmations(clean);
        const dirty = mergeConfirmations([...clean, at(r * Math.cos(angle), r * Math.sin(angle))]);
        expect(distanceM(base?.coordinate as [number, number], dirty?.coordinate as [number, number])).toBeLessThan(3);
      }),
    );
  });
});
