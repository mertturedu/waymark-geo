import fc from 'fast-check';
import { distanceM } from '../../src/core/geo/distance';
import { CELL_SCALE, cellOf, cellsOfLine, cellsAround } from '../../src/core/geo/cells';

const cell = (cx: number, cy: number): number => cy * 65536 + cx;

describe('cellOf', () => {
  it('maps a point to the grid cell of 0.002 degrees', () => {
    expect(CELL_SCALE).toBe(500);
    expect(cellOf(29.0, 41.0)).toBe(cell(14500, 20500));
    expect(cellOf(29.0019, 41.0019)).toBe(cell(14500, 20500));
    expect(cellOf(29.002, 41.0)).toBe(cell(14501, 20500));
    expect(cellOf(29.0, 41.002)).toBe(cell(14500, 20501));
  });

  it('keeps neighbouring cells apart and never gives a negative number inside Turkey', () => {
    fc.assert(
      fc.property(fc.double({ min: 25, max: 45, noNaN: true }), fc.double({ min: 35, max: 43, noNaN: true }), (lon, lat) => {
        expect(cellOf(lon, lat)).toBeGreaterThan(0);
        expect(cellOf(lon + 0.002, lat)).toBe(cellOf(lon, lat) + 1);
      }),
      { numRuns: 500, seed: 51 },
    );
  });
});

describe('cellOf on stored coordinates', () => {
  it('agrees with whole number arithmetic on the micro degree values, also on cell borders', () => {
    fc.assert(
      fc.property(fc.integer({ min: 25_000_000, max: 45_000_000 }), fc.integer({ min: 35_000_000, max: 43_000_000 }), (lonE6, latE6) => {
        expect(cellOf(lonE6 / 1e6, latE6 / 1e6)).toBe(Math.floor(latE6 / 2000) * 65536 + Math.floor(lonE6 / 2000));
      }),
      { numRuns: 5000, seed: 53 },
    );
    for (let k = 12500; k <= 22500; k++) expect(cellOf((k * 2000) / 1e6, 41.0)).toBe(cell(k, 20500));
    for (let k = 17500; k <= 21500; k++) expect(cellOf(29.0, (k * 2000) / 1e6)).toBe(cell(14500, k));
    for (const k of [14499, 14500, 14501, 22000]) expect(cellOf((k * 2000) / 1e6, 41.0)).toBe(cell(k, 20500));
    for (const k of [17500, 20501, 21000]) expect(cellOf(29.0, (k * 2000) / 1e6)).toBe(cell(14500, k));
  });
});

describe('cellsOfLine', () => {
  it('gives one cell for a short line inside it', () => {
    expect(cellsOfLine([[29.0005, 41.0005], [29.0015, 41.0012]])).toEqual([cell(14500, 20500)]);
  });

  it('gives every cell a horizontal line crosses, sorted', () => {
    expect(cellsOfLine([[29.0005, 41.0005], [29.0045, 41.0005]])).toEqual([cell(14500, 20500), cell(14501, 20500), cell(14502, 20500)]);
  });

  it('gives the cells a diagonal passes through and not the ones it misses', () => {
    const cells = cellsOfLine([[29.0001, 41.0001], [29.0059, 41.0039]]);
    expect(cells).toContain(cell(14500, 20500));
    expect(cells).toContain(cell(14502, 20501));
    expect(cells).not.toContain(cell(14500, 20501));
    expect(cells).not.toContain(cell(14502, 20500));
  });

  it('counts every cell that touches the line when it runs along a cell edge', () => {
    expect(cellsOfLine([[29.0, 41.0005], [29.0, 41.0035]])).toEqual([cell(14499, 20500), cell(14500, 20500), cell(14499, 20501), cell(14500, 20501)]);
  });

  it('handles one point, no points and a repeated point', () => {
    expect(cellsOfLine([[29.0005, 41.0005]])).toEqual([cell(14500, 20500)]);
    expect(cellsOfLine([])).toEqual([]);
    expect(cellsOfLine([[29.0005, 41.0005], [29.0005, 41.0005]])).toEqual([cell(14500, 20500)]);
  });

  it('merges the cells of every segment without repeats', () => {
    const cells = cellsOfLine([[29.0005, 41.0005], [29.0045, 41.0005], [29.0005, 41.0005]]);
    expect(cells).toEqual([cell(14500, 20500), cell(14501, 20500), cell(14502, 20500)]);
  });

  it('always includes the cell of the first and last point', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.double({ min: 28.9, max: 29.1, noNaN: true }), fc.double({ min: 40.9, max: 41.1, noNaN: true })), { minLength: 1, maxLength: 8 }), (line) => {
        const cells = cellsOfLine(line as [number, number][]);
        expect(cells).toContain(cellOf(line[0]![0], line[0]![1]));
        expect(cells).toContain(cellOf(line[line.length - 1]![0], line[line.length - 1]![1]));
        expect([...cells].sort((a, b) => a - b)).toEqual(cells);
        expect(new Set(cells).size).toBe(cells.length);
      }),
      { numRuns: 500, seed: 52 },
    );
  });
});

describe('cellsAround', () => {
  it('lists the cells that cover a circle around a point', () => {
    const around = cellsAround([29.0, 41.0], 100);
    expect(around).toContain(cellOf(29.0, 41.0));
    expect(around).toContain(cellOf(28.9992, 40.9992));
    expect(around).toContain(cellOf(29.0008, 41.0008));
    expect(new Set(around).size).toBe(around.length);
    expect(around.length).toBeLessThanOrEqual(9);
  });

  it('grows with the radius and finds a point that lies exactly the radius away', () => {
    expect(cellsAround([29.0, 41.0], 1000).length).toBeGreaterThan(cellsAround([29.0, 41.0], 100).length);
    const east = cellOf(29.0 + 100 / (111320 * Math.cos((41 * Math.PI) / 180)), 41.0);
    expect(cellsAround([29.0, 41.0], 100)).toContain(east);
  });

  it('reaches a point that distanceM puts exactly the radius away', () => {
    const center: [number, number] = [29.0, 41.008988];
    const edge: [number, number] = [29.0, 40.999995];
    expect(distanceM(center, edge)).toBeLessThanOrEqual(1000.1);
    expect(cellsAround(center, 1000)).toContain(cellOf(edge[0], edge[1]));
  });

  it('is just the own cell for a radius of zero', () => {
    expect(cellsAround([29.0005, 41.0005], 0)).toEqual([cell(14500, 20500)]);
  });
});
