import { encodeBorders, createBorders } from '../../src/core/region/borders';
import { encodeRings } from '../../src/core/region/geom';
import type { Polygon, Ring } from '../../src/core/region/geom';

const square = (west: number, south: number, east: number, north: number): Ring => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const rows = [
  { plate: '34', rings: [[square(28.5, 40.5, 29.5, 41.5), square(28.9, 40.9, 29.1, 41.1)]] as Polygon[] },
  { plate: '06', rings: [[square(32, 39.5, 33, 40.5)]] as Polygon[] },
  { plate: '41', rings: [[square(29.5, 40.5, 30.5, 41.5)], [square(31, 41, 31.5, 41.5)]] as Polygon[] },
];

describe('createBorders', () => {
  const borders = createBorders(encodeBorders(rows));

  it('names the province a point lies in, holes and parts included', () => {
    expect(borders.provinceAt(28.6, 40.6)).toBe('34');
    expect(borders.provinceAt(32.5, 40)).toBe('06');
    expect(borders.provinceAt(31.2, 41.2)).toBe('41');
    expect(borders.provinceAt(30, 41)).toBe('41');
  });

  it('has no answer for the sea, other countries or a hole', () => {
    expect(borders.provinceAt(35, 45)).toBeNull();
    expect(borders.provinceAt(29, 41)).toBeNull();
    expect(borders.provinceAt(31.8, 41.2)).toBeNull();
  });

  it('gives the smaller plate for a point on a shared edge', () => {
    expect(borders.provinceAt(29.5, 41)).toBe('34');
  });

  it('lists plates in order and gives each bounds', () => {
    expect(borders.plates()).toEqual(['06', '34', '41']);
    expect(borders.provinceBounds('34')).toEqual([28.5, 40.5, 29.5, 41.5]);
    expect(borders.provinceBounds('41')).toEqual([29.5, 40.5, 31.5, 41.5]);
    expect(borders.provinceBounds('99')).toBeNull();
  });

  it('writes the same bytes whatever the order of the rows', () => {
    expect(Array.from(encodeBorders([...rows].reverse()))).toEqual(Array.from(encodeBorders(rows)));
  });

  it('refuses bytes that are cut short, from another version or carry a bad plate', () => {
    const bytes = encodeBorders(rows);
    expect(() => createBorders(bytes.slice(0, bytes.length - 2))).toThrow();
    expect(() => createBorders(Uint8Array.from([7, ...bytes.slice(1)]))).toThrow(/version/);
    expect(() => createBorders(new Uint8Array([]))).toThrow();
    expect(() => encodeBorders([{ plate: 'AB', rings: [] }])).toThrow(/plate/);
    expect(() => encodeBorders([{ plate: '99', rings: [] }])).toThrow(/plate/);
    expect(() => encodeBorders([rows[0] as (typeof rows)[0], rows[0] as (typeof rows)[0]])).toThrow(/twice/);
  });

  it('works with no provinces at all', () => {
    const none = createBorders(encodeBorders([]));
    expect(none.plates()).toEqual([]);
    expect(none.provinceAt(1, 1)).toBeNull();
  });
});

describe('borders edge cases', () => {
  const single = createBorders(encodeBorders([{ plate: '34', rings: [[square(28.5, 40.5, 29.5, 41.5)]] }]));

  it('answers on the border and not a hair outside on any of the four sides', () => {
    for (const [lng, lat] of [[28.5, 41], [29.5, 41], [29, 40.5], [29, 41.5]] as [number, number][]) expect(single.provinceAt(lng, lat)).toBe('34');
    for (const [lng, lat] of [[28.4999, 41], [29.5001, 41], [29, 40.4999], [29, 41.5001]] as [number, number][]) expect(single.provinceAt(lng, lat)).toBeNull();
  });

  it('accepts plates 01 and 81 and keeps ten as ten', () => {
    const many = createBorders(encodeBorders(['09', '10', '11', '01', '81'].map((plate) => ({ plate, rings: [[square(1, 1, 2, 2)]] }))));
    expect(many.plates()).toEqual(['01', '09', '10', '11', '81']);
  });

  it.each(['00', '82', '1', '123', 'ab', '', ' 5'])('refuses the plate %j', (plate) => {
    expect(() => encodeBorders([{ plate, rings: [] }])).toThrow(new RegExp(`^bad plate ${plate}$`));
  });

  it('names the plate it was given twice', () => {
    expect(() => encodeBorders([rows[0] as (typeof rows)[0], rows[0] as (typeof rows)[0]])).toThrow(/^plate 34 twice$/);
    expect(() => encodeBorders([rows[0] as (typeof rows)[0], rows[1] as (typeof rows)[0]])).not.toThrow();
  });

  it('refuses extra bytes at the end and says which version it saw', () => {
    const bytes = encodeBorders(rows);
    expect(() => createBorders(Uint8Array.from([...bytes, 0]))).toThrow(/trailing/);
    expect(() => createBorders(Uint8Array.from([7, ...bytes.slice(1)]))).toThrow(/^unknown borders version 7$/);
  });

  it('gives a province with no outline empty bounds and no hits', () => {
    const empty = createBorders(encodeBorders([{ plate: '05', rings: [] }]));
    expect(empty.provinceBounds('05')).toEqual([0, 0, 0, 0]);
    expect(empty.provinceAt(0, 0)).toBeNull();
  });
});

describe('borders bytes that cannot be right', () => {
  const payload = Array.from(encodeRings([[]]));
  const entry = (plate: number): number[] => [plate, 0, 0, 0, 0, payload.length, ...payload];

  it('refuses a plate outside 1 to 81 and plates that are not in rising order', () => {
    const file = (...plates: number[]): Uint8Array => Uint8Array.from([1, plates.length, ...plates.flatMap(entry)]);
    expect(createBorders(file(5, 6)).plates()).toEqual(['05', '06']);
    expect(() => createBorders(file(99))).toThrow(/plate/);
    expect(() => createBorders(file(0))).toThrow(/plate/);
    expect(() => createBorders(file(6, 5))).toThrow(/order/);
    expect(() => createBorders(file(5, 5))).toThrow(/order/);
  });
});
