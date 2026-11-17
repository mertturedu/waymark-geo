import type { LngLat } from '../../src/core/geo/cells';
import { bboxOf, inBbox, pointCount, simplifyLine, simplifyPolygons, simplifyRing, simplifyWithin } from '../../src/core/geo/simplify';

const M = 1 / 111_195;
const at = (east: number, north: number): LngLat => [29 + east * M / Math.cos((41 * Math.PI) / 180), 41 + north * M];

describe('bboxOf and inBbox', () => {
  it('boxes every part, says nothing for no points and tests a point', () => {
    const box = bboxOf([[[1, 2], [3, 1]], [[0, 5]]]);
    expect(box).toEqual([0, 1, 3, 5]);
    expect(bboxOf([])).toBeNull();
    expect(bboxOf([[]])).toBeNull();
    expect(inBbox(box as never, [1, 2])).toBe(true);
    expect(inBbox(box as never, [4, 2])).toBe(false);
  });
});

describe('simplifyLine', () => {
  it('drops points within the tolerance and keeps a real corner and both ends', () => {
    const straight = [at(0, 0), at(50, 0.5), at(100, -0.4), at(150, 0.3), at(200, 0)];
    expect(simplifyLine(straight, 2)).toEqual([straight[0], straight[4]]);
    const bent = [at(0, 0), at(100, 0), at(100, 100)];
    expect(simplifyLine(bent, 2)).toEqual(bent);
    expect(simplifyLine([at(0, 0), at(1, 1)], 2)).toEqual([at(0, 0), at(1, 1)]);
    expect(simplifyLine([at(0, 0), at(0, 0), at(0, 0)], 2)).toHaveLength(2);
    expect(simplifyLine([], 2)).toEqual([]);
  });
});

describe('simplifyWithin', () => {
  const wiggle = (count: number): LngLat[] => Array.from({ length: count }, (_, i) => at(i * 10, i % 2 === 0 ? 0 : 6));

  it('widens the tolerance until the points fit and drops a line that collapses', () => {
    const lines = [wiggle(200), wiggle(200)];
    expect(pointCount(simplifyWithin(lines, 2, 1000))).toBe(400);
    const fitted = simplifyWithin(lines, 2, 20);
    expect(pointCount(fitted)).toBeLessThanOrEqual(20);
    expect(fitted.every((l) => l.length >= 2)).toBe(true);
    expect(simplifyWithin([[at(0, 0)]], 2, 10)).toEqual([]);
  });
});

describe('simplifyRing and simplifyPolygons', () => {
  const circle = (r: number, n: number): LngLat[] => {
    const out = Array.from({ length: n }, (_, i) => at(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)));
    return [...out, out[0] as LngLat];
  };

  it('keeps a ring closed and shrinks a dense one, and leaves a tiny one alone', () => {
    const ring = circle(500, 400);
    const small = simplifyRing(ring, 10);
    expect(small.length).toBeLessThan(ring.length / 3);
    expect(small[0]).toEqual(small[small.length - 1]);
    const tiny: LngLat[] = [at(0, 0), at(1, 0), at(1, 1), at(0, 0)];
    expect(simplifyRing(tiny, 10)).toEqual(tiny);
    expect(simplifyRing(circle(500, 400).slice(0, -1), 10).length).toBeGreaterThanOrEqual(4);
    expect(simplifyRing([at(0, 0), at(0.001, 0), at(0, 0.001), at(0.001, 0.001), at(0, 0)], 10000)).toHaveLength(5);
  });

  it('fits polygons to a point budget', () => {
    const polygons = [[circle(500, 400), circle(100, 200)]];
    const fitted = simplifyPolygons(polygons, 0.5, 60);
    expect(pointCount(fitted.flat())).toBeLessThanOrEqual(60);
    expect(fitted[0]).toHaveLength(2);
  });
});
