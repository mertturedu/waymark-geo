import fc from 'fast-check';
import { projectOnLine } from '../../src/core/geo/distance';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import type { Polygon, Ring } from '../../src/core/region/geom';

const square = (west: number, south: number, east: number, north: number): Ring => [[west, south], [east, south], [east, north], [west, north], [west, south]];

const rows = [
  { plate: '34', rings: [[square(28.5, 40.5, 29.5, 41.5), square(28.9, 40.9, 29.1, 41.1)]] as Polygon[] },
  { plate: '41', rings: [[square(29.5, 40.5, 30.5, 41.5)], [square(31, 41, 31.5, 41.5)]] as Polygon[] },
  { plate: '06', rings: [[square(32, 39.5, 33, 40.5)]] as Polygon[] },
];

const borders = createBorders(encodeBorders(rows));
const KM_IN_DEGREES_LNG = 1000 / (111_195 * Math.cos((41 * Math.PI) / 180));

describe('nearBorder', () => {
  it('names the neighbour when the point is closer than the distance to the shared edge', () => {
    expect(borders.nearBorder(29.5 - 0.5 * KM_IN_DEGREES_LNG, 41, 1000)).toEqual(['41']);
    expect(borders.nearBorder(29.5 + 0.5 * KM_IN_DEGREES_LNG, 41, 1000)).toEqual(['34']);
  });

  it('still finds a neighbour that is nearly the full distance away, east-west and north-south', () => {
    expect(borders.nearBorder(29.5 - 0.95 * KM_IN_DEGREES_LNG, 41, 1000)).toEqual(['41']);
    expect(borders.nearBorder(32.5, 40.5 + 0.95 * (1000 / 111_195), 1000)).toEqual(['06']);
    expect(borders.nearBorder(32.5, 39.5 - 0.95 * (1000 / 111_195), 1000)).toEqual(['06']);
    expect(borders.nearBorder(32 - 0.95 * (1000 / (111_195 * Math.cos((40 * Math.PI) / 180))), 40, 1000)).toEqual(['06']);
    expect(borders.nearBorder(33 + 0.95 * (1000 / (111_195 * Math.cos((40 * Math.PI) / 180))), 40, 1000)).toEqual(['06']);
  });

  it('is empty farther than the distance and for a point far inland', () => {
    expect(borders.nearBorder(29.5 - 1.5 * KM_IN_DEGREES_LNG, 41, 1000)).toEqual([]);
    expect(borders.nearBorder(28.7, 41.2, 1000)).toEqual([]);
    expect(borders.nearBorder(32.5, 40, 1000)).toEqual([]);
  });

  it('never lists the province the point is in', () => {
    for (const [x, y] of [[29.4999, 41], [29.5001, 41], [28.7, 40.5001]] as [number, number][]) {
      const own = borders.provinceAt(x, y);
      expect(borders.nearBorder(x, y, 5000)).not.toContain(own);
    }
  });

  it('counts a hole edge as a border of the province around it', () => {
    expect(borders.provinceAt(29.0, 41.0)).toBeNull();
    expect(borders.nearBorder(29.0, 41.0, 20_000)).toEqual(['34']);
    expect(borders.nearBorder(29.0, 41.0, 5_000)).toEqual([]);
  });

  it('finds provinces near a point that is in none, such as the sea', () => {
    expect(borders.nearBorder(27.995, 41, 1000)).toEqual([]);
    expect(borders.nearBorder(28.5 - 0.5 * KM_IN_DEGREES_LNG, 41, 1000)).toEqual(['34']);
  });

  it('lists several neighbours in plate order', () => {
    expect(borders.provinceAt(29.5, 40.5)).toBe('34');
    expect(borders.nearBorder(29.5, 40.5, 1000)).toEqual(['41']);
    const corner = createBorders(encodeBorders([{ plate: '41', rings: [[square(29, 40, 29.5, 40.5)]] as Polygon[] }, { plate: '34', rings: [[square(29.5, 40, 30, 40.5)]] as Polygon[] }, { plate: '16', rings: [[square(29, 40.5, 30, 41)]] as Polygon[] }]));
    expect(corner.nearBorder(29.4999, 40.4999, 2000)).toEqual(['16', '34']);
  });

  it('gives an empty list for numbers that are not coordinates and distances that are not positive', () => {
    expect(borders.nearBorder(Number.NaN, 41, 1000)).toEqual([]);
    expect(borders.nearBorder(29.5, Infinity, 1000)).toEqual([]);
    expect(borders.nearBorder(29.5, 41, Number.NaN)).toEqual([]);
    expect(borders.nearBorder(29.4999, 41, 0)).toEqual([]);
    expect(borders.nearBorder(29.4999, 41, -5)).toEqual([]);
  });

  it('agrees with a plain scan over every edge', () => {
    const all = rows.map((r) => ({ plate: r.plate, polygons: r.rings }));
    fc.assert(
      fc.property(fc.double({ min: 27.5, max: 33.5, noNaN: true }), fc.double({ min: 39, max: 42, noNaN: true }), fc.constantFrom(200, 1000, 5000), (x, y, meters) => {
        const own = borders.provinceAt(x, y);
        const expected = all
          .filter((entry) => entry.plate !== own && entry.polygons.some((polygon) => polygon.some((ring) => projectOnLine([x, y], ring).distanceM <= meters)))
          .map((entry) => entry.plate)
          .sort();
        expect(borders.nearBorder(x, y, meters)).toEqual(expected);
      }),
      { numRuns: 400 },
    );
  });
});
