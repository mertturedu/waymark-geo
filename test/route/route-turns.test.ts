import { buildBaseGraph, type BaseGraph, type RoadRule, type RoadWay } from '../../pipeline/build/route-graph';
import { applyRestrictions, entryNode, exitNodes, type RoadGraph } from '../../pipeline/build/route-turns';
import { buildCsr, dijkstra } from '../../src/core/route/plain';
import { rows, way, type Pt } from '../helpers/road-world';

const X = 29;
const Y = 41;
const D = 0.001;

const C = [10, X, Y] as [number, number, number];
const N = [11, X, Y + D] as [number, number, number];
const S = [12, X, Y - D] as [number, number, number];
const E = [13, X + D, Y] as [number, number, number];
const W = [14, X - D, Y] as [number, number, number];

function arc(g: BaseGraph, wayId: number, fromOsm: number, toOsm: number): number {
  for (const index of g.wayEdges.get(wayId) ?? []) {
    const e = g.edges[index]!;
    if (g.nodeOsm[e.tail] === fromOsm && g.nodeOsm[e.head] === toOsm && e.forward) return 2 * index;
    if (g.nodeOsm[e.head] === fromOsm && g.nodeOsm[e.tail] === toOsm && e.backward) return 2 * index + 1;
  }
  throw new Error(`no arc ${wayId} ${fromOsm}->${toOsm}`);
}

function cost(g: RoadGraph, from: number, to: number): number {
  const csr = buildCsr(g.nodeCount, g.arcTail, g.arcHead, g.arcDs);
  const dist = dijkstra(csr, [{ node: entryNode(g, from), dist: 0 }]);
  return Math.min(...exitNodes(g, to).map((v) => dist[v] as number));
}

function build(ways: RoadWay[], rules: RoadRule[]): { base: BaseGraph; g: RoadGraph } {
  const base = buildBaseGraph(rows(ways, rules), { ferries: false });
  return { base, g: applyRestrictions(base, rules) };
}

const no = (id: number, restriction: string, from: number, to: number, via: RoadRule['via']): RoadRule => ({ id, kind: 'no', restriction, from, to, via });
const only = (id: number, restriction: string, from: number, to: number, via: RoadRule['via']): RoadRule => ({ id, kind: 'only', restriction, from, to, via });

const W2 = [15, X - D, Y + D / 2] as [number, number, number];

const cross = (): RoadWay[] => [
  way(1, [S, C], { oneway: 'f' }),
  way(2, [C, N], { oneway: 'f' }),
  way(3, [W, C], { oneway: 'b' }),
  way(4, [C, E], { oneway: 'f' }),
  way(5, [W2, C], { oneway: 'f' }),
];

describe('applyRestrictions without rules', () => {
  it('is the base graph: one node per junction, one arc per allowed direction', () => {
    const { base, g } = build(cross(), []);
    expect(g.nodeCount).toBe(base.nodeLon.length);
    expect(g.arcTail.length).toBe(base.edges.length);
    expect(cost(g, arc(base, 1, 12, 10), arc(base, 4, 10, 13))).toBe(0);
  });
});

describe('node restrictions', () => {
  it('forbids exactly the banned turn and leaves other approaches alone', () => {
    const { base, g } = build(cross(), [no(1, 'no_left_turn', 1, 3, [{ n: 10 }])]);
    const fromSouth = arc(base, 1, 12, 10);
    expect(cost(g, fromSouth, arc(base, 3, 10, 14))).toBe(Infinity);
    expect(cost(g, fromSouth, arc(base, 2, 10, 11))).toBe(0);
    expect(cost(g, fromSouth, arc(base, 4, 10, 13))).toBe(0);
    expect(cost(g, arc(base, 5, 15, 10), arc(base, 3, 10, 14))).toBe(0);
    expect(g.nodeCount).toBe(base.nodeLon.length + 1);
  });

  it('finds a way round when there is one', () => {
    const ring = [...cross(), way(6, [N, W2], { oneway: 'f' })];
    const { base, g } = build(ring, [no(1, 'no_left_turn', 1, 3, [{ n: 10 }])]);
    const detour = cost(g, arc(base, 1, 12, 10), arc(base, 3, 10, 14));
    expect(detour).toBeGreaterThan(0);
    expect(detour).toBeLessThan(Infinity);
  });

  it('turns a mandatory turn into bans on every other exit', () => {
    const { base, g } = build(cross(), [only(1, 'only_straight_on', 1, 2, [{ n: 10 }])]);
    const fromSouth = arc(base, 1, 12, 10);
    expect(cost(g, fromSouth, arc(base, 2, 10, 11))).toBe(0);
    expect(cost(g, fromSouth, arc(base, 3, 10, 14))).toBe(Infinity);
    expect(cost(g, fromSouth, arc(base, 4, 10, 13))).toBe(Infinity);
    expect(cost(g, arc(base, 5, 15, 10), arc(base, 4, 10, 13))).toBe(0);
  });

  it('picks the matching side when the banned road runs through the junction', () => {
    const through: RoadWay[] = [way(1, [W, C, E]), way(2, [C, N]), way(3, [S, C])];
    const { base, g } = build(through, [no(1, 'no_left_turn', 1, 2, [{ n: 10 }])]);
    const northbound = arc(base, 2, 10, 11);
    expect(cost(g, arc(base, 1, 14, 10), northbound)).toBeGreaterThan(0);
    expect(cost(g, arc(base, 1, 13, 10), northbound)).toBe(0);
  });

  it('bans a u-turn only along the same road', () => {
    const { base, g } = build([way(1, [S, C]), way(2, [C, N], { oneway: 'f' }), way(3, [C, E], { oneway: 'f' })], [no(1, 'no_u_turn', 1, 1, [{ n: 10 }])]);
    const fromSouth = arc(base, 1, 12, 10);
    expect(cost(g, fromSouth, arc(base, 1, 10, 12))).toBe(Infinity);
    expect(cost(g, fromSouth, arc(base, 2, 10, 11))).toBe(0);
  });

  it('ignores rules that name roads which are not there', () => {
    const { g, base } = build(cross(), [no(1, 'no_left_turn', 99, 3, [{ n: 10 }]), no(2, 'no_left_turn', 1, 3, [{ n: 77 }])]);
    expect(g.nodeCount).toBe(base.nodeLon.length);
    expect(g.report.skipped).toEqual({ 'no-arcs': 2 });
  });
});

describe('restrictions through a road', () => {
  const approach = (): RoadWay[] => [
    way(1, [[20, X - 2 * D, Y], [21, X - D, Y]], { oneway: 'f' }),
    way(2, [[21, X - D, Y], [22, X, Y], [23, X + D, Y]], { oneway: 'f' }),
    way(3, [[23, X + D, Y], [24, X + 2 * D, Y]], { oneway: 'f' }),
    way(4, [[25, X - D, Y - D], [21, X - D, Y]], { oneway: 'f' }),
  ];

  it('bans only the whole sequence, not the parts', () => {
    const { base, g } = build(approach(), [no(1, 'no_straight_on', 1, 3, [{ w: 2 }])]);
    const a = arc(base, 1, 20, 21);
    const via = arc(base, 2, 21, 23);
    const out = arc(base, 3, 23, 24);
    expect(cost(g, a, out)).toBe(Infinity);
    expect(cost(g, arc(base, 4, 25, 21), out)).toBeLessThan(Infinity);
    expect(cost(g, via, out)).toBeLessThan(Infinity);
    expect(cost(g, a, via)).toBe(0);
  });

  it('keeps only the named exit after a mandatory sequence', () => {
    const extra = [...approach(), way(5, [[23, X + D, Y], [26, X + D, Y + D]], { oneway: 'f' })];
    const { base, g } = build(extra, [only(1, 'only_straight_on', 1, 3, [{ w: 2 }])]);
    const a = arc(base, 1, 20, 21);
    expect(cost(g, a, arc(base, 3, 23, 24))).toBeLessThan(Infinity);
    expect(cost(g, a, arc(base, 5, 23, 26))).toBe(Infinity);
    expect(cost(g, arc(base, 4, 25, 21), arc(base, 5, 23, 26))).toBeLessThan(Infinity);
  });

  it('does not let a vehicle turn round on the connecting road to get past a ban', () => {
    const connector: RoadWay[] = [
      way(1, [[20, X - 2 * D, Y], [21, X - D, Y]], { oneway: 'f' }),
      way(2, [[21, X - D, Y], [22, X, Y]]),
      way(3, [[22, X, Y], [23, X + D, Y]], { oneway: 'f' }),
    ];
    const { base, g } = build(connector, [no(1, 'no_straight_on', 1, 3, [{ w: 2 }])]);
    expect(cost(g, arc(base, 1, 20, 21), arc(base, 3, 22, 23))).toBe(Infinity);
    expect(cost(g, arc(base, 2, 21, 22), arc(base, 3, 22, 23))).toBe(0);
  });

  it('still lets a vehicle turn round at a dead end after a ban', () => {
    const stub: RoadWay[] = [
      way(1, [S, C], { oneway: 'f' }),
      way(2, [C, N]),
      way(3, [C, W], { oneway: 'f' }),
    ];
    const { base, g } = build(stub, [no(1, 'no_left_turn', 1, 3, [{ n: 10 }])]);
    const detour = cost(g, arc(base, 1, 12, 10), arc(base, 3, 10, 14));
    expect(detour).toBeGreaterThan(0);
    expect(detour).toBeLessThan(Infinity);
  });

  it('keeps a ban in force when the vehicle reaches its first road from the middle of another ban', () => {
    const R: Pt = [30, X - 3 * D, Y];
    const T: Pt = [31, X - 2 * D, Y + D];
    const Sx: Pt = [32, X - 2 * D, Y];
    const V: Pt = [33, X - D, Y];
    const Wx: Pt = [34, X, Y];
    const chain: RoadWay[] = [
      way(1, [R, Sx], { oneway: 'f' }),
      way(2, [Sx, T], { oneway: 'f' }),
      way(3, [Sx, V], { oneway: 'f' }),
      way(4, [V, Wx], { oneway: 'f' }),
    ];
    const rules = [no(1, 'no_left_turn', 1, 2, [{ n: 32 }]), no(2, 'no_straight_on', 3, 4, [{ n: 33 }])];
    const { base, g } = build(chain, rules);
    expect(cost(g, arc(base, 1, 30, 32), arc(base, 4, 33, 34))).toBe(Infinity);
    expect(cost(g, arc(base, 1, 30, 32), arc(base, 3, 32, 33))).toBe(0);
  });

  it('applies the bans of a shorter history to a longer one as well', () => {
    const R: Pt = [30, X - 3 * D, Y];
    const Sx: Pt = [32, X - 2 * D, Y];
    const V: Pt = [33, X - D, Y];
    const Wx: Pt = [34, X, Y];
    const Z: Pt = [35, X - D, Y + D];
    const chain: RoadWay[] = [
      way(1, [R, Sx], { oneway: 'f' }),
      way(3, [Sx, V], { oneway: 'f' }),
      way(4, [V, Wx], { oneway: 'f' }),
      way(5, [V, Z], { oneway: 'f' }),
    ];
    const rules = [no(1, 'no_straight_on', 3, 4, [{ n: 33 }]), no(2, 'no_straight_on', 1, 4, [{ w: 3 }])];
    const { base, g } = build(chain, rules);
    expect(cost(g, arc(base, 1, 30, 32), arc(base, 4, 33, 34))).toBe(Infinity);
    expect(cost(g, arc(base, 1, 30, 32), arc(base, 5, 33, 35))).toBeLessThan(Infinity);
  });

  it('bans only the side the rule names when the last road of a via-way ban runs through the junction', () => {
    const F0: Pt = [40, X, Y - 2 * D];
    const F1: Pt = [41, X, Y - D];
    const B: Pt = [42, X, Y];
    const Wst: Pt = [43, X - D, Y];
    const Est: Pt = [44, X + D, Y];
    const layout: RoadWay[] = [
      way(1, [F0, F1], { oneway: 'f' }),
      way(2, [F1, B], { oneway: 'f' }),
      way(3, [Wst, B, Est]),
    ];
    const free = build(layout, []);
    const open = (turn: string, rule: number, goal: [number, number]) => {
      const built = build(layout, [no(rule, turn, 1, 3, [{ w: 2 }])]);
      return cost(built.g, arc(built.base, 1, 40, 41), arc(built.base, 3, goal[0], goal[1]));
    };
    const base = (goal: [number, number]) => cost(free.g, arc(free.base, 1, 40, 41), arc(free.base, 3, goal[0], goal[1]));
    expect(open('no_left_turn', 1, [42, 43])).toBeGreaterThan(base([42, 43]));
    expect(open('no_left_turn', 1, [42, 44])).toBe(base([42, 44]));
    expect(open('no_right_turn', 2, [42, 44])).toBeGreaterThan(base([42, 44]));
    expect(open('no_right_turn', 2, [42, 43])).toBe(base([42, 43]));
  });
});
