import { distanceM } from '../../src/core/geo/distance';
import { MAX_M, MIN_M, pickPairs, sharePerPlate } from '../../scripts/export-oracle-routes';

const grid = Array.from({ length: 400 }, (_, i) => [29 + (i % 20) * 0.01, 41 + Math.floor(i / 20) * 0.01] as [number, number]);

describe('pickPairs', () => {
  it('chooses far apart but not too far apart pairs, the same ones every time', () => {
    const a = pickPairs(grid, 30, 7);
    expect(a).toHaveLength(30);
    for (const [x, y] of a) {
      expect(distanceM(x, y)).toBeGreaterThanOrEqual(MIN_M);
      expect(distanceM(x, y)).toBeLessThanOrEqual(MAX_M);
    }
    expect(pickPairs(grid, 30, 7)).toEqual(a);
    expect(pickPairs(grid, 30, 8)).not.toEqual(a);
  });

  it('gives fewer pairs, not an endless loop, when the points cannot make them', () => {
    expect(pickPairs([[29, 41]], 5, 1)).toEqual([]);
    expect(pickPairs([[29, 41], [29.0001, 41]], 5, 1)).toEqual([]);
  });
});

describe('sharePerPlate', () => {
  it('splits 200 over 12 provinces without losing any', () => {
    const shares = sharePerPlate(12);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(200);
    expect(Math.max(...shares) - Math.min(...shares)).toBe(1);
    expect(sharePerPlate(3, 10)).toEqual([4, 3, 3]);
  });
});
