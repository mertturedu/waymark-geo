import { buildBaseGraph, type RoadWay } from '../../pipeline/build/route-graph';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { NO_SEGMENT, buildTrafficSegments, channelOf, segmentFeature } from '../../pipeline/build/traffic-segments';
import { readRoutePack } from '../../src/core/route/format';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const at = (id: number, east: number, north = 0): Pt => [id, 29 + deg(east) / Math.cos((41 * Math.PI) / 180), 41 + deg(north)];
const build = (ways: RoadWay[]) => {
  const base = buildBaseGraph(rows(ways), { ferries: false });
  return { base, set: buildTrafficSegments(base) };
};
const edgeOf = (base: ReturnType<typeof build>['base'], wayId: number): number => (base.wayEdges.get(wayId) as number[])[0] as number;

describe('traffic segments of the main roads', () => {
  it('joins two ways of one road into a single segment and leaves side streets out', () => {
    const { base, set } = build([
      way(1, [at(1, 0), at(2, 200)], { cls: 'primary' }),
      way(2, [at(2, 200), at(3, 400)], { cls: 'primary' }),
      way(3, [at(2, 200), at(9, 200, 200)]),
    ]);
    expect(set.segments).toHaveLength(1);
    expect(set.segments[0]?.edges).toHaveLength(2);
    expect(set.segments[0]?.lengthM).toBeGreaterThan(390);
    expect(set.edgeSegment[edgeOf(base, 3)]).toBe(NO_SEGMENT);
    expect(channelOf(set, 2 * edgeOf(base, 3))).toBe(NO_SEGMENT);
  });

  it('cuts where another main road joins', () => {
    const { set } = build([
      way(1, [at(1, 0), at(2, 300), at(3, 600)], { cls: 'primary' }),
      way(2, [at(2, 300), at(4, 300, 300)], { cls: 'secondary' }),
    ]);
    expect(set.segments).toHaveLength(3);
    expect(set.segments.map((segment) => Math.round(segment.lengthM / 100))).toEqual([3, 3, 3]);
  });

  it('does not join roads of different classes or a one-way road with a two-way one', () => {
    const classes = build([way(1, [at(1, 0), at(2, 200)], { cls: 'primary' }), way(2, [at(2, 200), at(3, 400)], { cls: 'secondary' })]);
    const ways = build([way(1, [at(1, 0), at(2, 200)], { cls: 'primary', oneway: 'f' }), way(2, [at(2, 200), at(3, 400)], { cls: 'primary' })]);
    expect(classes.set.segments).toHaveLength(2);
    expect(ways.set.segments).toHaveLength(2);
  });

  it('cuts a long road with no main junction into pieces of 600 to 800 m at side streets', () => {
    const main = Array.from({ length: 11 }, (_, i) => at(10 + i, 200 * i));
    const sides = main.slice(1, -1).map((point, i) => way(100 + i, [point, at(200 + i, 200 * (i + 1), 150)]));
    const { set } = build([way(1, main, { cls: 'secondary' }), ...sides]);
    const lengths = set.segments.map((segment) => Math.round(segment.lengthM));
    expect(lengths.length).toBeGreaterThanOrEqual(3);
    expect(lengths.every((length) => length >= 600 && length <= 800)).toBe(true);
    expect(lengths.reduce((sum, length) => sum + length, 0)).toBe(2000);
  });

  it('folds a short piece into the one before it', () => {
    const { set } = build([
      way(1, [at(1, 0), at(2, 300), at(3, 330), at(4, 630)], { cls: 'primary' }),
      way(2, [at(2, 300), at(5, 300, 300)], { cls: 'secondary' }),
      way(3, [at(3, 330), at(6, 330, -300)], { cls: 'secondary' }),
    ]);
    const lengths = set.segments.filter((segment) => segment.cls === set.segments[0]?.cls).map((segment) => Math.round(segment.lengthM));
    expect(lengths).toEqual([330, 300]);
  });

  it('lays a one-way segment in the direction of travel and gives each direction of a road its own channel', () => {
    const { base, set } = build([way(1, [at(1, 0), at(2, 200)], { cls: 'primary', oneway: 'b' }), way(2, [at(5, 0, 500), at(6, 200, 500)], { cls: 'primary' })]);
    const back = edgeOf(base, 1);
    const both = edgeOf(base, 2);
    const oneway = set.segments[set.edgeSegment[back] as number];
    expect(oneway?.oneway).toBe(true);
    expect(oneway?.line[0]).toBe(base.nodeLon[base.edges[back]?.head as number]);
    expect(set.edgeFlip[back]).toBe(1);
    expect(channelOf(set, 2 * back + 1)).toBe(2 * (set.edgeSegment[back] as number));
    expect(channelOf(set, 2 * both)).not.toBe(channelOf(set, 2 * both + 1));
    expect(channelOf(set, 2 * both) >> 1).toBe(set.edgeSegment[both]);
  });

  it('keeps the keys of a road when another road is added elsewhere', () => {
    const road = [way(1, [at(1, 0), at(2, 300), at(3, 600)], { cls: 'primary' }), way(2, [at(2, 300), at(4, 300, 300)], { cls: 'secondary' })];
    const before = build(road).set.segments.map((segment) => segment.key).sort();
    const after = build([way(7, [at(70, 5000), at(71, 5400)], { cls: 'trunk' }), ...road]).set.segments.map((segment) => segment.key).sort();
    expect(after).toEqual(expect.arrayContaining(before));
    expect(new Set(after).size).toBe(after.length);
    expect(before).toContain('1:1');
  });

  it('closes a ring road that has no junction', () => {
    const ring = [at(1, 0), at(2, 100), at(3, 100, 100), at(4, 0, 100), at(1, 0)];
    const { set } = build([way(1, ring, { cls: 'tertiary', oneway: 'f' })]);
    expect(set.segments).toHaveLength(1);
    expect(set.segments[0]?.line.slice(0, 2)).toEqual(set.segments[0]?.line.slice(-2));
  });

  it('numbers its edges the way the route pack does', () => {
    const ways = [way(1, [at(1, 0), at(2, 300), at(3, 600)], { cls: 'primary' }), way(2, [at(2, 300), at(4, 300, 300)], { cls: 'secondary' }), way(3, [at(3, 600), at(5, 600, 300)])];
    const { base } = build(ways);
    const pack = readRoutePack(buildRoutePack(rows(ways), { ferries: false }).bytes);
    expect(pack.edges.tail.length).toBe(base.edges.length);
    expect([...pack.edges.tail]).toEqual(base.edges.map((e) => e.tail));
    expect([...pack.edges.head]).toEqual(base.edges.map((e) => e.head));
  });

  it('writes a map feature with its number, class and direction', () => {
    const { set } = build([way(1, [at(1, 0), at(2, 200)], { cls: 'motorway', oneway: 'f' })]);
    const feature = JSON.parse(segmentFeature(set.segments[0] as never, 0));
    expect(feature.properties).toEqual({ s: 0, c: 0, d: 1 });
    expect(feature.tippecanoe.minzoom).toBe(6);
    expect(feature.geometry.coordinates).toHaveLength(2);
  });
});
