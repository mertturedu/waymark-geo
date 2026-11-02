import fc from 'fast-check';
import { distanceM, lineLengthM, pointAlong, projectOnLine } from '../../src/core/geo/distance';

const haversine = (a: [number, number], b: [number, number]): number => {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
};

describe('distanceM', () => {
  it('is zero for the same point and symmetric', () => {
    expect(distanceM([29, 41], [29, 41])).toBe(0);
    expect(distanceM([29, 41], [29.01, 41.02])).toBeCloseTo(distanceM([29.01, 41.02], [29, 41]), 6);
  });

  it('gives about 111 km for a degree of latitude and shrinks with latitude for longitude', () => {
    expect(distanceM([29, 40], [29, 41])).toBeGreaterThan(111_000);
    expect(distanceM([29, 40], [29, 41])).toBeLessThan(111_400);
    expect(distanceM([29, 41], [30, 41])).toBeLessThan(distanceM([29, 36], [30, 36]));
  });

  it('stays within half a percent of the great circle for city sized distances', () => {
    fc.assert(
      fc.property(fc.double({ min: 26, max: 44, noNaN: true }), fc.double({ min: 36, max: 42, noNaN: true }), fc.double({ min: -0.1, max: 0.1, noNaN: true }), fc.double({ min: -0.1, max: 0.1, noNaN: true }), (lon, lat, dx, dy) => {
        const a: [number, number] = [lon, lat];
        const b: [number, number] = [lon + dx, lat + dy];
        const truth = haversine(a, b);
        if (truth > 50) expect(Math.abs(distanceM(a, b) - truth) / truth).toBeLessThan(0.005);
      }),
      { numRuns: 2000, seed: 61 },
    );
  });
});

describe('lineLengthM and pointAlong', () => {
  const line: [number, number][] = [[29, 41], [29.01, 41], [29.01, 41.01]];

  it('add up the segments', () => {
    expect(lineLengthM(line)).toBeCloseTo(distanceM(line[0]!, line[1]!) + distanceM(line[1]!, line[2]!), 6);
    expect(lineLengthM([[29, 41]])).toBe(0);
    expect(lineLengthM([])).toBe(0);
  });

  it('walk along the line and stay on its ends outside it', () => {
    const total = lineLengthM(line);
    expect(pointAlong(line, 0)).toEqual([29, 41]);
    expect(pointAlong(line, total)).toEqual([29.01, 41.01]);
    expect(pointAlong(line, -50)).toEqual([29, 41]);
    expect(pointAlong(line, total + 50)).toEqual([29.01, 41.01]);
    const first = distanceM(line[0]!, line[1]!);
    const corner = pointAlong(line, first);
    expect(corner[0]).toBeCloseTo(29.01, 8);
    expect(corner[1]).toBeCloseTo(41, 8);
    const half = pointAlong(line, first / 2);
    expect(half[0]).toBeCloseTo(29.005, 6);
    expect(half[1]).toBeCloseTo(41, 8);
  });

  it('give the empty and single point cases without failing', () => {
    expect(pointAlong([[29, 41]], 10)).toEqual([29, 41]);
    expect(() => pointAlong([], 10)).toThrow(/empty/);
  });
});

describe('projectOnLine', () => {
  const line: [number, number][] = [[29, 41], [29.01, 41], [29.01, 41.01]];

  it('puts a point beside the line on its foot with the distance and the walk', () => {
    const result = projectOnLine([29.005, 41.0005], line);
    expect(result.point[0]).toBeCloseTo(29.005, 6);
    expect(result.point[1]).toBeCloseTo(41, 8);
    expect(result.distanceM).toBeCloseTo(distanceM([29.005, 41.0005], [29.005, 41]), 0);
    expect(result.alongM).toBeCloseTo(distanceM([29, 41], [29.005, 41]), 0);
  });

  it('returns the line itself for a point on it and the end for a point beyond it', () => {
    const on = projectOnLine([29.01, 41.005], line);
    expect(on.distanceM).toBeLessThan(0.01);
    expect(on.alongM).toBeCloseTo(distanceM(line[0]!, line[1]!) + distanceM(line[1]!, [29.01, 41.005]), 0);
    const beyond = projectOnLine([29.02, 41.02], line);
    expect(beyond.point).toEqual([29.01, 41.01]);
    expect(beyond.alongM).toBeCloseTo(lineLengthM(line), 3);
  });

  it('handles a one point line and a line that doubles back', () => {
    expect(projectOnLine([29.1, 41.1], [[29, 41]]).point).toEqual([29, 41]);
    const back: [number, number][] = [[29, 41], [29.01, 41], [29, 41.0001]];
    expect(projectOnLine([29.0005, 41.00005], back).distanceM).toBeLessThan(12);
  });

  it('refuses an empty line', () => {
    expect(() => projectOnLine([29, 41], [])).toThrow(/empty/);
  });

  it('is consistent with pointAlong', () => {
    fc.assert(
      fc.property(fc.double({ min: 28.99, max: 29.02, noNaN: true }), fc.double({ min: 40.99, max: 41.02, noNaN: true }), (lon, lat) => {
        const projected = projectOnLine([lon, lat], line);
        const again = pointAlong(line, projected.alongM);
        expect(distanceM(again, projected.point)).toBeLessThan(0.5);
      }),
      { numRuns: 1000, seed: 62 },
    );
  });
});
