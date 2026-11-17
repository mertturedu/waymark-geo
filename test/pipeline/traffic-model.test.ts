import { FEATURE_COUNT, addPlace, addRoads, cellAt, cellKey, cellOfGeohash, featuresOf, geohashOfCell, hasMainRoad, type CellGrid } from '../../pipeline/build/traffic-features';
import { curveOf, meanCurve, predictCurve, predictScores, principalCurves, trainTrafficModel, TRAIN_OPTIONS } from '../../pipeline/build/traffic-model';
import { compactModel, mergeProfiles, predictProfile } from '../../pipeline/build/traffic-predict';
import { geohash } from '../../src/core/traffic/observed';
import { deg, way, type Pt } from '../helpers/road-world';

const at = (id: number, east: number, north = 0): Pt => [id, 29 + deg(east) / Math.cos((41 * Math.PI) / 180), 41 + deg(north)];

describe('cells of the traffic model', () => {
  it('names a cell the way a geohash of six letters does', () => {
    const [i, j] = cellAt(29.0203857, 41.0971069);
    expect(geohashOfCell(i, j)).toBe(geohash(41.0971069, 29.0203857, 6));
    expect(cellOfGeohash('sxk9u3')).toEqual([i, j]);
  });

  it('counts road length by class, junctions and places in the cell they lie in', () => {
    const grid: CellGrid = new Map();
    addRoads(grid, [way(1, [at(1, 0), at(2, 100)], { cls: 'primary', oneway: 'f' }), way(2, [at(2, 100), at(3, 100, 100)]), way(3, [at(8, 0, 50), at(9, 100, 50)], { cls: 'residential', ferry: true })]);
    addPlace(grid, 29, 41, 'food');
    addPlace(grid, 29, 41, 'bank');
    const values = grid.get(cellKey(...cellAt(29, 41))) as Float64Array;
    expect(values[2]).toBeCloseTo(0.1, 2);
    expect(values[6]).toBeCloseTo(0.1, 2);
    expect(values[8]).toBeCloseTo(0.1, 2);
    expect(values[9]).toBe(1);
    expect(values[10]).toBe(1);
    expect(values[11]).toBe(1);
    expect(values[14]).toBe(1);
    expect(hasMainRoad(values)).toBe(true);
  });

  it('describes a cell by itself and by what is around it', () => {
    const grid: CellGrid = new Map();
    addRoads(grid, [way(1, [at(1, 0), at(2, 100)], { cls: 'motorway' })]);
    const [i, j] = cellAt(29, 41);
    const here = featuresOf(grid, i, j);
    const near = featuresOf(grid, i + 2, j);
    const far = featuresOf(grid, i + 20, j);
    expect(here).toHaveLength(FEATURE_COUNT);
    expect(here[0]).toBeGreaterThan(0);
    expect(near[0]).toBe(0);
    expect(near.some((v) => v > 0)).toBe(true);
    expect(far.every((v) => v === 0)).toBe(true);
  });
});

describe('traffic model', () => {
  const shape = Array.from({ length: 24 }, (_, hour) => (hour >= 7 && hour <= 19 ? 1 : 0.1));
  const sample = (count: number, offset = 0) => {
    const x: Float64Array[] = [];
    const curves: (number | null)[][] = [];
    for (let n = 0; n < count; n++) {
      const density = ((n + offset) * 37) % 100;
      const noise = ((n * 13) % 7) / 100;
      x.push(Float64Array.from([density, (n * 7) % 11, noise]));
      curves.push(shape.map((value, hour) => (n % 9 === 0 && hour === 3 ? null : (density / 250) * value)));
    }
    return { x, curves };
  };
  const options = { ...TRAIN_OPTIONS, components: 2, rounds: 80, rate: 0.1, depth: 3, minLeaf: 5 };

  it('averages the hours that were seen', () => {
    expect(meanCurve([[0.2, null], [0.4, 0.1]], 2)).toEqual([expect.closeTo(0.3, 6), 0.1]);
  });

  it('finds the main way in which curves differ', () => {
    const rows = [1, -1, 2, -2].map((scale) => Float64Array.from([scale, 2 * scale, 0]));
    const [first] = principalCurves(rows, 3, 1) as [number[]];
    expect(first[1] as number / (first[0] as number)).toBeCloseTo(2, 3);
    expect(first[2]).toBeCloseTo(0, 6);
  });

  it('learns that denser cells are slower and predicts cells it has not seen', () => {
    const train = sample(300);
    const model = trainTrafficModel(train.x, train.curves, options);
    const test = sample(40, 5);
    let error = 0;
    test.x.forEach((row, n) => {
      const guess = predictCurve(model, row);
      error += Math.abs((guess[12] as number) - ((test.curves[n] as number[])[12] as number));
    });
    expect(error / 40).toBeLessThan(0.03);
    expect(predictCurve(model, Float64Array.from([90, 0, 0]))[12]).toBeGreaterThan(predictCurve(model, Float64Array.from([10, 0, 0]))[12] as number);
    expect(predictCurve(model, Float64Array.from([10, 0, 0])).every((v) => v >= 0)).toBe(true);
  });

  it('gives the same model for the same data and keeps its answers after it is written to a file', () => {
    const train = sample(120);
    const a = trainTrafficModel(train.x, train.curves, options);
    const b = trainTrafficModel(train.x, train.curves, options);
    expect(JSON.stringify(compactModel(a))).toBe(JSON.stringify(compactModel(b)));
    const stored = JSON.parse(JSON.stringify(compactModel(a)));
    const row = Float64Array.from([55, 3, 0.02]);
    predictCurve(stored, row).forEach((value, hour) => expect(value).toBeCloseTo(predictCurve(a, row)[hour] as number, 4));
    expect(curveOf(a, predictScores(a, row))).toEqual(predictCurve(a, row));
  });

  it('writes a profile for the cells with a main road and fills the gaps of an observed one', () => {
    const train = sample(120);
    const grid: CellGrid = new Map();
    addRoads(grid, [way(1, [at(1, 0), at(2, 100)], { cls: 'primary' }), way(2, [at(5, 9000), at(6, 9100)])]);
    const tall = trainTrafficModel(train.x.map((row) => Float64Array.from({ length: FEATURE_COUNT }, (_, k) => row[k % 3] as number)), train.curves, options);
    const profile = predictProfile(tall, grid);
    const cell = geohash(41, 29, 6);
    expect(Object.keys(profile.cells)).toEqual([cell]);
    expect(profile.cells[cell]).toHaveLength(24);
    expect(predictProfile(tall, grid, () => false).cells).toEqual({});
    const seen = { precision: 6, levels: 35, cells: { [cell]: `-${'z'.repeat(23)}`, other: 'a'.repeat(24) } };
    const merged = mergeProfiles(seen, profile);
    expect(merged.cells[cell]?.[0]).toBe(profile.cells[cell]?.[0]);
    expect(merged.cells[cell]?.slice(1)).toBe('z'.repeat(23));
    expect(merged.cells.other).toBe('a'.repeat(24));
  });
});
