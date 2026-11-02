import { arcWeight, entryNode, exitNodes, sameEdgeCost, sourceLabels, targetLabels } from '../../src/core/route/labels';
import type { Snap } from '../../src/core/route/snap';
import { junctionPenalty } from '../../src/core/route/speeds';
import { deg, rows, way, type Pt } from '../helpers/road-world';
import { makePack } from '../helpers/route-world';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);
const onEdge = (edge: number, offsetM: number): Snap => ({ edge, offsetM, distanceM: 0, point: [0, 0] });

function spider(arms: number) {
  const hub: Pt = [1, X, Y];
  const ways = [];
  const rules = [];
  for (let i = 0; i < arms; i++) {
    const angle = (i / arms) * 2 * Math.PI;
    const into: Pt = [100 + i, X + lon(300 * Math.cos(angle)), Y + deg(300 * Math.sin(angle))];
    const out: Pt = [200 + i, X + lon(600 * Math.cos(angle)), Y + deg(600 * Math.sin(angle))];
    ways.push(way(10 + i, [into, hub], { oneway: 'f' }), way(50 + i, [hub, out], { oneway: 'f' }));
    rules.push({ id: i + 1, kind: 'no' as const, restriction: 'no_left_turn', from: 10 + i, to: 50 + i, via: [{ n: 1 }] });
  }
  return makePack(rows(ways, rules));
}

function edgeOfWay(graph: { base: { wayEdges: Map<number, number[]> } }, wayId: number): number {
  return (graph.base.wayEdges.get(wayId) as number[])[0] as number;
}

describe('entry and exit tables', () => {
  const { pack, graph } = spider(9);

  it('sends an arrival that has a copy to the copy and any other arrival to the node itself', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 9; i++) {
      const pa = 2 * edgeOfWay(graph, 10 + i);
      const node = entryNode(pack, pa);
      expect(node).not.toBe(pack.base.node[graph.base.edges[pa >> 1]!.head]);
      seen.add(node);
    }
    expect(seen.size).toBe(9);
    const leaving = 2 * edgeOfWay(graph, 50);
    expect(entryNode(pack, leaving)).toBe(pack.base.node[graph.base.edges[leaving >> 1]!.head]);
    expect(entryNode(pack, 2 * edgeOfWay(graph, 50) + 1)).toBe(pack.base.node[graph.base.edges[leaving >> 1]!.tail]);
  });

  it('lists the node itself first and then every copy that may take the road, once each', () => {
    for (let i = 0; i < 9; i++) {
      const pa = 2 * edgeOfWay(graph, 50 + i);
      const nodes = exitNodes(pack, pa);
      expect(nodes[0]).toBe(pack.base.node[graph.base.edges[pa >> 1]!.tail]);
      expect(nodes).toHaveLength(9);
      expect(new Set(nodes).size).toBe(9);
      expect(nodes.slice(1)).toEqual([...nodes.slice(1)].sort((a, b) => a - b));
      expect(nodes).not.toContain(entryNode(pack, 2 * edgeOfWay(graph, 10 + i)));
    }
    expect(exitNodes(pack, 2 * edgeOfWay(graph, 10))).toEqual([pack.base.node[graph.base.edges[edgeOfWay(graph, 10)]!.tail]]);
  });
});

describe('stop labels on a two-way road with a junction at one end', () => {
  const T = (cls: 'residential' | 'motorway'): ReturnType<typeof makePack> =>
    makePack(rows([
      way(1, [[1, X, Y], [2, X + lon(1000), Y]], { cls }),
      way(2, [[2, X + lon(1000), Y], [3, X + lon(1000), Y + deg(500)]]),
      way(3, [[2, X + lon(1000), Y], [4, X + lon(1000), Y - deg(500)]]),
    ]));

  it('charges the junction at the end the vehicle arrives at, and only there', () => {
    const { pack, graph } = T('residential');
    const edge = graph.base.wayEdges.get(1)![0] as number;
    const toJunction = graph.base.edges[edge]!.head === graph.base.nodeOsm.indexOf(2) ? 0 : 1;
    const length = pack.edges.length[edge] as number;
    const labels = sourceLabels(pack, onEdge(edge, length * 0.3));
    const forward = labels.find((l) => l.pa === 2 * edge)!;
    const backward = labels.find((l) => l.pa === 2 * edge + 1)!;
    const travel = pack.edges.travel;
    const arrivesAtJunction = toJunction === 0 ? forward : backward;
    const arrivesAtLeaf = toJunction === 0 ? backward : forward;
    expect(arrivesAtJunction.w - arrivesAtLeaf.w).not.toBe(0);
    expect(forward.w).toBe(Math.round((travel[2 * edge] as number) * 0.7) + (toJunction === 0 ? junctionPenalty('residential') : 0));
    expect(backward.w).toBe(Math.round((travel[2 * edge + 1] as number) * 0.3) + (toJunction === 1 ? junctionPenalty('residential') : 0));
    expect(forward.len).toBe(Math.round(length * 0.7));
    expect(backward.len).toBe(Math.round(length * 0.3));
  });

  it('charges the smaller motorway junction penalty on a motorway', () => {
    const { pack, graph } = T('motorway');
    const edge = graph.base.wayEdges.get(1)![0] as number;
    const toJunction = graph.base.edges[edge]!.head === graph.base.nodeOsm.indexOf(2) ? 0 : 1;
    const labels = sourceLabels(pack, onEdge(edge, 100));
    for (const label of labels) {
      const share = (label.pa & 1 ? 100 : (pack.edges.length[edge] as number) - 100) / (pack.edges.length[edge] as number);
      expect(label.w).toBe(Math.round((pack.edges.travel[label.pa] as number) * share) + ((label.pa & 1) === toJunction ? junctionPenalty('motorway') : 0));
    }
  });

  it('prices the way in by the part of the road already driven, without a penalty', () => {
    const { pack, graph } = T('residential');
    const edge = graph.base.wayEdges.get(1)![0] as number;
    const length = pack.edges.length[edge] as number;
    const labels = targetLabels(pack, onEdge(edge, length * 0.25));
    const forward = labels.find((l) => l.pa === 2 * edge)!;
    const backward = labels.find((l) => l.pa === 2 * edge + 1)!;
    expect(forward.w).toBe(Math.round((pack.edges.travel[2 * edge] as number) * 0.25));
    expect(backward.w).toBe(Math.round((pack.edges.travel[2 * edge + 1] as number) * 0.75));
    expect(forward.len).toBe(Math.round(length * 0.25));
    expect(backward.len).toBe(Math.round(length * 0.75));
    expect(arcWeight(pack, 2 * edge) - (pack.edges.travel[2 * edge] as number)).toBeGreaterThanOrEqual(0);
  });

  it('keeps a stop beyond either end of the road at that end', () => {
    const { pack, graph } = T('residential');
    const edge = graph.base.wayEdges.get(1)![0] as number;
    const length = pack.edges.length[edge] as number;
    expect(targetLabels(pack, onEdge(edge, length * 5))[0]?.w).toBe(targetLabels(pack, onEdge(edge, length))[0]?.w);
    expect(targetLabels(pack, onEdge(edge, -50))[0]?.w).toBe(targetLabels(pack, onEdge(edge, 0))[0]?.w);
    expect(sourceLabels(pack, onEdge(edge, -50)).map((l) => l.w)).toEqual(sourceLabels(pack, onEdge(edge, 0)).map((l) => l.w));
  });

  it('weighs a pa by its travel time plus the penalty it carries', () => {
    const { pack, graph } = T('residential');
    const edge = graph.base.wayEdges.get(1)![0] as number;
    const total = arcWeight(pack, 2 * edge) + arcWeight(pack, 2 * edge + 1);
    const travel = (pack.edges.travel[2 * edge] as number) + (pack.edges.travel[2 * edge + 1] as number);
    expect(total).toBe(travel + junctionPenalty('residential'));
  });
});

describe('sameEdgeCost', () => {
  const road = (oneway: '' | 'f' | 'b') => makePack(rows([way(1, [[1, X, Y], [2, X + lon(1000), Y]], { oneway })]));

  it('goes the way the road allows and refuses the other', () => {
    const forward = road('f').pack;
    const length = forward.edges.length[0] as number;
    const ahead = sameEdgeCost(forward, onEdge(0, length * 0.2), onEdge(0, length * 0.7));
    expect(ahead).toEqual({ w: Math.round((forward.edges.travel[0] as number) * 0.5), len: Math.round(length * 0.5), pa: 0 });
    expect(sameEdgeCost(forward, onEdge(0, length * 0.7), onEdge(0, length * 0.2))).toBeNull();
    const backward = road('b').pack;
    expect(sameEdgeCost(backward, onEdge(0, length * 0.7), onEdge(0, length * 0.2))).toMatchObject({ pa: 1, len: Math.round(length * 0.5) });
    expect(sameEdgeCost(backward, onEdge(0, length * 0.2), onEdge(0, length * 0.7))).toBeNull();
  });

  it('on a two-way road picks the direction of travel and gives zero for the same spot', () => {
    const { pack } = road('');
    const length = pack.edges.length[0] as number;
    expect(sameEdgeCost(pack, onEdge(0, length * 0.2), onEdge(0, length * 0.7))?.pa).toBe(0);
    expect(sameEdgeCost(pack, onEdge(0, length * 0.7), onEdge(0, length * 0.2))?.pa).toBe(1);
    expect(sameEdgeCost(pack, onEdge(0, 400), onEdge(0, 400))).toEqual({ w: 0, len: 0, pa: 0 });
  });

  it('has nothing to say about two different roads', () => {
    const { pack } = makePack(rows([way(1, [[1, X, Y], [2, X + lon(500), Y]]), way(2, [[2, X + lon(500), Y], [3, X + lon(1000), Y]])]));
    expect(sameEdgeCost(pack, onEdge(0, 10), onEdge(1, 10))).toBeNull();
  });
});
