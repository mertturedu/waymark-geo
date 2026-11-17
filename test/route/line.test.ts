import { join, pointAt, reverse, slice } from '../../src/core/route/line';

const M = 1e6;
const flat = (...points: [number, number][]): number[] => points.flatMap(([lon, lat]) => [lon * M, lat * M]);

describe('pointAt', () => {
  const line = flat([29, 41], [29, 41.001], [29.001, 41.001]);

  it('walks along the line by the share of its length', () => {
    expect(pointAt(line, 0)).toEqual([29 * M, 41 * M]);
    expect(pointAt(line, 1)).toEqual([29.001 * M, 41.001 * M]);
    const [x, y] = pointAt(line, 0.25);
    expect(x).toBeCloseTo(29 * M, 3);
    expect(y).toBeGreaterThan(41 * M);
    expect(y).toBeLessThan(41.001 * M);
  });

  it('clamps outside zero and one and survives a line with no length', () => {
    expect(pointAt(line, -3)).toEqual([29 * M, 41 * M]);
    expect(pointAt(line, 7)).toEqual([29.001 * M, 41.001 * M]);
    expect(pointAt(flat([29, 41], [29, 41]), 0.5)).toEqual([29 * M, 41 * M]);
  });
});

describe('slice', () => {
  const line = flat([29, 41], [29, 41.001], [29.001, 41.001]);

  it('cuts a piece in either direction and keeps the corners inside it', () => {
    const forward = slice(line, 0.2, 0.9);
    expect(forward.length).toBe(6);
    expect(forward[2]).toBe(29 * M);
    expect(forward[3]).toBe(41.001 * M);
    const backward = slice(line, 0.9, 0.2);
    expect(backward).toEqual(reverse(forward));
  });

  it('gives the two ends for a whole line and a single point for equal shares', () => {
    expect(slice(line, 0, 1)).toEqual(line);
    const point = slice(line, 0.5, 0.5);
    expect(point.length).toBe(4);
    expect(point.slice(0, 2)).toEqual(point.slice(2, 4));
    expect(slice(flat([29, 41], [29, 41]), 0, 1)).toEqual(flat([29, 41], [29, 41]));
  });
});

describe('reverse and join', () => {
  it('reverses the order of points, not of the two numbers of a point', () => {
    expect(reverse([1, 2, 3, 4, 5, 6])).toEqual([5, 6, 3, 4, 1, 2]);
    expect(reverse([])).toEqual([]);
  });

  it('joins pieces and drops the repeated point where they meet', () => {
    expect(join([[1, 2, 3, 4], [3, 4, 5, 6], [], [5, 6, 7, 8]])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(join([[1, 2], [1, 3]])).toEqual([1, 2, 1, 3]);
    expect(join([])).toEqual([]);
  });
});

describe('local scale', () => {
  const lat = 41;
  const cos = Math.cos((lat * Math.PI) / 180);
  const eastThenNorth = flat([29, lat], [29.001, lat], [29.001, lat + 0.001]);

  it('measures east-west steps shorter than north-south ones at this latitude', () => {
    const corner = (0.001 * cos) / (0.001 * cos + 0.001);
    const [x, y] = pointAt(eastThenNorth, corner);
    expect(x).toBeCloseTo(29.001 * M, 0);
    expect(y).toBeCloseTo(lat * M, 0);
    const [mx, my] = pointAt(eastThenNorth, 0.5);
    expect(my).toBeGreaterThan(lat * M);
    expect(mx).toBeCloseTo(29.001 * M, 0);
  });

  it('keeps a corner only when it lies strictly inside the piece', () => {
    const corner = (0.001 * cos) / (0.001 * cos + 0.001);
    expect(slice(eastThenNorth, corner + 0.001, 1)).toHaveLength(4);
    expect(slice(eastThenNorth, 0, corner - 0.001)).toHaveLength(4);
    expect(slice(eastThenNorth, corner - 0.001, corner + 0.001)).toHaveLength(6);
  });

  it('gives a point on a line of one point and joins pieces whose ends are the same point twice', () => {
    expect(pointAt([5, 6], 0.3)).toEqual([5, 6]);
    expect(join([[1, 2], [1, 2], [1, 2, 3, 4]])).toEqual([1, 2, 3, 4]);
    expect(join([[1, 2, 3, 4], [1, 2]])).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it('puts the cut ends exactly where the shares say along a straight line', () => {
    const straight = flat([29, lat], [29.01, lat]);
    const piece = slice(straight, 0.25, 0.75);
    expect(piece[0]).toBeCloseTo(29.0025 * M, 0);
    expect(piece[2]).toBeCloseTo(29.0075 * M, 0);
    expect(pointAt(straight, 0.5)[0]).toBeCloseTo(29.005 * M, 0);
  });
});
