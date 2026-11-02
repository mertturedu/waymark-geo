import fc from 'fast-check';
import { decodeLine, decodeLines, decodeRings, encodeLine, encodeLines, encodeRings, pointInRings, type Polygon, type Ring } from '../../src/core/region/geom';

const square = (west: number, south: number, east: number, north: number): Ring => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const snap = (value: number, scale = 1e6): number => Math.round(value * scale) / scale + 0;
const snapRing = (ring: Ring): Ring => ring.map(([x, y]) => [snap(x), snap(y)]);

describe('encodeRings and decodeRings', () => {
  it('give back the same polygons rounded to the scale', () => {
    const polygons: Polygon[] = [[square(28.5, 40.5, 29.5, 41.5), square(28.8, 40.8, 29.1, 41.1)], [square(32, 39.5, 33, 40.5)]];
    expect(decodeRings(encodeRings(polygons))).toEqual(polygons);
  });

  it('rounds to the scale and keeps negative and large coordinates', () => {
    const polygons: Polygon[] = [[[[-179.9999996, -89.0000004], [180, -89], [180, 89.1234567], [-179.9999996, -89.0000004]]]];
    expect(decodeRings(encodeRings(polygons))).toEqual([[snapRing(polygons[0]![0]!)]]);
  });

  it('handles no polygons, a polygon with no rings and an empty ring', () => {
    expect(decodeRings(encodeRings([]))).toEqual([]);
    expect(decodeRings(encodeRings([[]]))).toEqual([[]]);
    expect(decodeRings(encodeRings([[[]]]))).toEqual([[[]]]);
  });

  it('honours another scale and records it in the bytes', () => {
    const polygons: Polygon[] = [[[[1.23456, 2.34567], [1.5, 2.5], [1.23456, 2.34567]]]];
    expect(decodeRings(encodeRings(polygons, 1e5))).toEqual([[[[1.23456, 2.34567], [1.5, 2.5], [1.23456, 2.34567]]]]);
    expect(decodeRings(encodeRings(polygons, 1e2))).toEqual([[[[1.23, 2.35], [1.5, 2.5], [1.23, 2.35]]]]);
  });

  it('is small for a dense outline', () => {
    const ring: Ring = Array.from({ length: 1000 }, (_, i) => [29 + Math.cos(i / 159) * 0.2, 41 + Math.sin(i / 159) * 0.2]);
    expect(encodeRings([[ring]]).length).toBeLessThan(1000 * 6);
  });

  it('round-trips random polygons', () => {
    const point = fc.tuple(fc.double({ min: -180, max: 180, noNaN: true }), fc.double({ min: -90, max: 90, noNaN: true }));
    fc.assert(
      fc.property(fc.array(fc.array(fc.array(point, { maxLength: 12 }), { maxLength: 3 }), { maxLength: 3 }), (polygons) => {
        const expected = polygons.map((polygon) => polygon.map(snapRing));
        expect(decodeRings(encodeRings(polygons as Polygon[]))).toEqual(expected);
      }),
      { numRuns: 2000, seed: 33 },
    );
  });

  it('refuses bytes that are cut short or have an unknown version', () => {
    const bytes = encodeRings([[square(1, 1, 2, 2)]]);
    expect(() => decodeRings(bytes.slice(0, bytes.length - 3))).toThrow();
    expect(() => decodeRings(new Uint8Array([9, 1, 1]))).toThrow(/version/);
    expect(() => decodeRings(new Uint8Array([]))).toThrow();
  });
});

describe('encodeLine and decodeLine', () => {
  it('give back a line rounded to the scale', () => {
    const line: Ring = [[28.600001, 40.900001], [28.7, 40.9], [28.9, 40.95]];
    expect(decodeLine(encodeLine(line))).toEqual(snapRing(line));
    expect(decodeLine(encodeLine([]))).toEqual([]);
  });

  it('rejects trailing bytes and a polygon payload', () => {
    expect(() => decodeLine(new Uint8Array([...encodeLine([[1, 1]]), 0]))).toThrow();
    expect(() => decodeLine(encodeRings([[square(1, 1, 2, 2)]]))).toThrow();
  });
});

describe('pointInRings', () => {
  const outer = square(0, 0, 10, 10);
  const hole = square(4, 4, 6, 6);

  it('is true inside, false outside', () => {
    expect(pointInRings([2, 2], [[outer]])).toBe(true);
    expect(pointInRings([12, 2], [[outer]])).toBe(false);
    expect(pointInRings([-0.0001, 5], [[outer]])).toBe(false);
  });

  it('counts the border of the outer ring as inside', () => {
    expect(pointInRings([0, 5], [[outer]])).toBe(true);
    expect(pointInRings([10, 10], [[outer]])).toBe(true);
    expect(pointInRings([5, 0], [[outer]])).toBe(true);
  });

  it('leaves out a hole but keeps its border', () => {
    expect(pointInRings([5, 5], [[outer, hole]])).toBe(false);
    expect(pointInRings([4, 5], [[outer, hole]])).toBe(true);
    expect(pointInRings([3, 5], [[outer, hole]])).toBe(true);
  });

  it('looks at every polygon of a multi polygon', () => {
    const second = square(20, 20, 30, 30);
    expect(pointInRings([25, 25], [[outer], [second]])).toBe(true);
    expect(pointInRings([15, 15], [[outer], [second]])).toBe(false);
    expect(pointInRings([1, 1], [])).toBe(false);
    expect(pointInRings([1, 1], [[]])).toBe(false);
  });

  it('works for a concave outline', () => {
    const concave: Ring = [[0, 0], [10, 0], [10, 10], [5, 3], [0, 10], [0, 0]];
    expect(pointInRings([5, 1], [[concave]])).toBe(true);
    expect(pointInRings([5, 8], [[concave]])).toBe(false);
    expect(pointInRings([0.3, 9], [[concave]])).toBe(true);
    expect(pointInRings([1, 9], [[concave]])).toBe(false);
  });
});

describe('encodeLines and decodeLines', () => {
  it('give back several lines rounded to the scale', () => {
    const lines: Ring[] = [[[28.6, 40.9], [28.7, 40.9]], [], [[28.8, 40.95], [28.9, 40.97], [29.000001, 41]]];
    expect(decodeLines(encodeLines(lines))).toEqual(lines.map(snapRing));
    expect(decodeLines(encodeLines([]))).toEqual([]);
  });

  it('refuses another kind of payload and cut bytes', () => {
    expect(() => decodeLines(encodeLine([[1, 1]]))).toThrow();
    const bytes = encodeLines([[[1, 1], [2, 2]]]);
    expect(() => decodeLines(bytes.slice(0, bytes.length - 1))).toThrow();
  });
});

describe('byte level behaviour', () => {
  it('writes a number below 128 in one byte and from 128 in two', () => {
    expect(Array.from(encodeLine([[63, 0]], 1))).toEqual([1, 1, 1, 1, 126, 0]);
    expect(Array.from(encodeLine([[64, 0]], 1))).toEqual([1, 1, 1, 1, 128, 1, 0]);
    expect(Array.from(encodeLine([[-64, 0]], 1))).toEqual([1, 1, 1, 1, 127, 0]);
    expect(Array.from(encodeLine([[-65, 0]], 1))).toEqual([1, 1, 1, 1, 129, 1, 0]);
  });

  it.each([63, 64, 65, -63, -64, -65, 8191, 8192, -8192, -8193, 1_048_575, 1_048_576, 180_000_000])('round-trips the step %d', (step) => {
    const line: Ring = [[0, 0], [step, -step], [step * 2, 1]];
    expect(decodeLine(encodeLine(line, 1))).toEqual(line);
  });

  it('says what is wrong with bad bytes, for every kind', () => {
    const rings = encodeRings([[square(1, 1, 2, 2)]]);
    const line = encodeLine([[1, 1]]);
    const lines = encodeLines([[[1, 1]]]);
    expect(() => decodeRings(Uint8Array.from([...rings, 0]))).toThrow(/trailing data/);
    expect(() => decodeLine(Uint8Array.from([...line, 0]))).toThrow(/trailing data/);
    expect(() => decodeLines(Uint8Array.from([...lines, 0]))).toThrow(/trailing data/);
    expect(() => decodeRings(rings.slice(0, rings.length - 1))).toThrow(/end too early/);
    expect(() => decodeRings(new Uint8Array([]))).toThrow(/end too early/);
    expect(() => decodeLine(rings)).toThrow(/kind does not match/);
    expect(() => decodeRings(line)).toThrow(/kind does not match/);
    expect(() => decodeLines(line)).toThrow(/kind does not match/);
    expect(() => decodeRings(new Uint8Array([2, 0, 1, 0]))).toThrow(/unknown geometry version 2/);
  });

  it('reads the last byte of the input', () => {
    const bytes = encodeLine([[1, 1]]);
    expect(decodeLine(bytes)).toEqual([[1, 1]]);
    expect(() => decodeLine(bytes.slice(0, bytes.length - 1))).toThrow(/end too early/);
  });
});

describe('pointInRings on slanted and vertex aligned edges', () => {
  const triangle: Ring = [[0, 0], [4, 0], [0, 4], [0, 0]];
  const diamond: Ring = [[2, 0], [4, 2], [2, 4], [0, 2], [2, 0]];

  it('counts a point on a slanted edge as inside and the line beyond its ends as outside', () => {
    expect(pointInRings([2, 2], [[triangle]])).toBe(true);
    expect(pointInRings([1, 3], [[triangle]])).toBe(true);
    expect(pointInRings([5, -1], [[triangle]])).toBe(false);
    expect(pointInRings([-1, 5], [[triangle]])).toBe(false);
    expect(pointInRings([2.001, 2.001], [[triangle]])).toBe(false);
    expect(pointInRings([1.999, 1.999], [[triangle]])).toBe(true);
    expect(pointInRings([3, 1], [[triangle]])).toBe(true);
    expect(pointInRings([3, 3], [[triangle]])).toBe(false);
  });

  it('reads rows through the vertices of a diamond', () => {
    for (const p of [[2, 2], [1, 2], [3, 2], [0.5, 2], [3.5, 2], [2, 1], [2, 3]] as [number, number][]) expect(pointInRings(p, [[diamond]])).toBe(true);
    for (const p of [[-1, 2], [5, 2], [0.4, 2.9], [3.9, 3.9], [4.5, 2], [2, -0.5], [2, 4.5]] as [number, number][]) expect(pointInRings(p, [[diamond]])).toBe(false);
    for (const p of [[2, 0], [4, 2], [2, 4], [0, 2], [3, 1], [1, 3]] as [number, number][]) expect(pointInRings(p, [[diamond]])).toBe(true);
  });

  it('is not fooled by a hole touching the outline', () => {
    const outer = square(0, 0, 10, 10);
    const touching: Ring = [[0, 4], [4, 4], [4, 6], [0, 6], [0, 4]];
    expect(pointInRings([0, 5], [[outer, touching]])).toBe(true);
    expect(pointInRings([2, 5], [[outer, touching]])).toBe(false);
    expect(pointInRings([4, 5], [[outer, touching]])).toBe(true);
    expect(pointInRings([6, 5], [[outer, touching]])).toBe(true);
  });
});

describe('bytes that cannot be right', () => {
  it('refuses a scale of zero', () => {
    expect(() => decodeLine(new Uint8Array([1, 1, 0, 1, 2, 2]))).toThrow(/scale/);
    expect(() => decodeRings(new Uint8Array([1, 0, 0, 0]))).toThrow(/scale/);
    expect(() => decodeLines(new Uint8Array([1, 2, 0, 0]))).toThrow(/scale/);
  });
});
