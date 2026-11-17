import { encodeSlowdowns, type ObservedProfile } from '../../src/core/traffic/observed';
import { CELL_BITS, featuresOf, geohashOfCell, hasMainRoad, type CellGrid } from './traffic-features';
import { predictCurve, type TrafficModel } from './traffic-model';

export const PREDICT_LEVELS = 35;
const PRECISION = 6;

export function predictProfile(model: TrafficModel, grid: CellGrid, keep: (lon: number, lat: number) => boolean = () => true): ObservedProfile {
  const size = 2 ** CELL_BITS;
  const cells: Record<string, string> = {};
  for (const key of [...grid.keys()].sort((a, b) => a - b)) {
    if (!hasMainRoad(grid.get(key) as Float64Array)) continue;
    const i = Math.floor(key / size);
    const j = key % size;
    if (!keep(((i + 0.5) * 360) / size - 180, ((j + 0.5) * 180) / size - 90)) continue;
    cells[geohashOfCell(i, j)] = encodeSlowdowns(predictCurve(model, featuresOf(grid, i, j)), PREDICT_LEVELS);
  }
  return { precision: PRECISION, levels: PREDICT_LEVELS, cells };
}

export function mergeProfiles(observed: ObservedProfile, predicted: ObservedProfile): ObservedProfile {
  const cells: Record<string, string> = { ...predicted.cells };
  for (const [cell, text] of Object.entries(observed.cells)) {
    const guess = predicted.cells[cell];
    cells[cell] = guess === undefined ? text : [...text].map((ch, slot) => (ch === '-' ? (guess[slot] as string) : ch)).join('');
  }
  return { precision: observed.precision, levels: observed.levels, cells };
}

export function compactModel(model: TrafficModel): TrafficModel {
  const round = (value: number): number => Number(value.toPrecision(6));
  return {
    ...model,
    mean: model.mean.map(round),
    basis: model.basis.map((curve) => curve.map(round)),
    base: model.base.map(round),
    trees: model.trees.map((forest) => forest.map((tree) => ({ feature: [...tree.feature], cut: Array.from(tree.cut, round), left: [...tree.left], right: [...tree.right], value: Array.from(tree.value, round) }))),
  };
}
