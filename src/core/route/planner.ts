import { createSearcher } from './ch-query';
import { edgeLine, type RoutePack } from './format';
import { sameEdgeCost, sourceLabels, targetLabels, type ArcLabel } from './labels';
import { join, reverse, slice } from './line';
import { createMatrixSolver, type Matrix } from './matrix';
import { snapPoint, type Snap, type SnapResult } from './snap';

export type RouteLeg = { durationDs: number; distanceM: number; line: number[]; arcs: number[] };

export type Planner = {
  snap(lng: number, lat: number): SnapResult;
  route(from: Snap, to: Snap): RouteLeg | null;
  matrix(from: ReadonlyArray<Snap>, to: ReadonlyArray<Snap>): Matrix;
};

const arcLine = (pack: RoutePack, pa: number): number[] => {
  const line = edgeLine(pack, pa >> 1);
  return (pa & 1) === 0 ? line : reverse(line);
};

const fractionOf = (pack: RoutePack, snap: Snap): number => {
  const length = pack.edges.length[snap.edge] as number;
  return length === 0 ? 0 : Math.min(1, Math.max(0, snap.offsetM / length));
};

export function createPlanner(pack: RoutePack): Planner {
  const searcher = createSearcher(pack.hierarchy);
  const solver = createMatrixSolver(pack.hierarchy);

  const direct = (from: Snap, to: Snap): RouteLeg | null => {
    const cost = sameEdgeCost(pack, from, to);
    if (cost === null) return null;
    const a = fractionOf(pack, from);
    const b = fractionOf(pack, to);
    return { durationDs: cost.w, distanceM: cost.len, line: slice(edgeLine(pack, from.edge), a, b), arcs: [cost.pa] };
  };

  return {
    snap: (lng, lat) => snapPoint(pack, lng, lat),

    route(from, to) {
      const here = direct(from, to);
      const sources = sourceLabels(pack, from);
      const targets = targetLabels(pack, to);
      const found = searcher.path(sources, targets);
      if (found === null) return here;
      const start = sources[found.from] as ArcLabel;
      const end = targets[found.to] as ArcLabel;
      const durationDs = found.weight;
      if (here !== null && here.durationDs <= durationDs) return here;
      const a = fractionOf(pack, from);
      const b = fractionOf(pack, to);
      const first = (start.pa & 1) === 0 ? slice(edgeLine(pack, from.edge), a, 1) : slice(edgeLine(pack, from.edge), a, 0);
      const last = (end.pa & 1) === 0 ? slice(edgeLine(pack, to.edge), 0, b) : slice(edgeLine(pack, to.edge), 1, b);
      const line = join([first, ...found.arcs.map((pa) => arcLine(pack, pa)), last]);
      return { durationDs, distanceM: found.length, line, arcs: [start.pa, ...found.arcs, end.pa] };
    },

    matrix(from, to) {
      const result = solver.solve(from.map((s) => sourceLabels(pack, s)), to.map((s) => targetLabels(pack, s)));
      from.forEach((a, i) => {
        to.forEach((b, j) => {
          const cost = sameEdgeCost(pack, a, b);
          const at = i * to.length + j;
          if (cost !== null && cost.w <= (result.w[at] as number)) {
            result.w[at] = cost.w;
            result.len[at] = cost.len;
          }
        });
      });
      return result;
    },
  };
}
