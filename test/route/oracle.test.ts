import { UNREACHABLE } from '../../src/core/route/matrix';
import { oracleWeights, plainGraph } from '../../src/core/route/oracle';
import { createPlanner } from '../../src/core/route/planner';
import { labelsOf } from './helpers';
import { deg, rows, way } from '../helpers/road-world';
import { makePack } from '../helpers/route-world';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);

describe('oracle over a real pack', () => {
  const world = (): ReturnType<typeof makePack> =>
    makePack(rows([
      way(1, [[1, X, Y], [2, X + lon(500), Y]], { oneway: 'f' }),
      way(2, [[2, X + lon(500), Y], [3, X + lon(500), Y + deg(500)]]),
      way(3, [[3, X + lon(500), Y + deg(500)], [1, X, Y]], { oneway: 'f' }),
      way(4, [[7, X + 5, Y + 5], [8, X + 5.002, Y + 5]]),
    ]));

  it('keeps the original arcs only and gives them the weights of the pack', () => {
    const { pack } = world();
    const graph = plainGraph(pack.hierarchy);
    expect(graph.n).toBe(pack.hierarchy.n);
    const total = Array.from(graph.w).reduce((a, b) => a + b, 0);
    let expected = 0;
    for (let e = 0; e < pack.edges.count; e++) expected += (pack.edges.travel[2 * e] as number) + (pack.edges.travel[2 * e + 1] as number);
    expect(total).toBeGreaterThanOrEqual(expected);
    expect(graph.to.length).toBe(pack.edges.travel.filter((t) => t > 0).length);
  });

  it('answers a table of stops like the hierarchy does and marks the unreachable ones', () => {
    const { pack } = world();
    const planner = createPlanner(pack);
    const stops = [0, 1, 2, 3].map((edge) => ({ edge, offsetM: 10, distanceM: 0, point: [0, 0] as [number, number] }));
    const table = planner.matrix(stops, stops);
    const truth = oracleWeights(plainGraph(pack.hierarchy), stops.map((s) => labelsOf(pack, s).from), stops.map((s) => labelsOf(pack, s).to));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (i !== j) expect(truth[i * 4 + j]).toBe(table.w[i * 4 + j]);
    expect(truth[0 * 4 + 3]).toBe(UNREACHABLE);
    expect(truth[3 * 4 + 0]).toBe(UNREACHABLE);
  });
});
