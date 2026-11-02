import { edgeLine } from '../../src/core/route/format';
import { project, snapPoint } from '../../src/core/route/snap';
import { deg, rows, way } from '../helpers/road-world';
import { makePack } from '../helpers/route-world';

const X = 29;
const Y = 41;
const lonDeg = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);

describe('snapPoint', () => {
  it('lands on the nearest road with the foot point and the distance along it', () => {
    const { pack } = makePack(rows([way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]])]));
    const got = snapPoint(pack, X + lonDeg(400), Y + deg(30));
    expect(got).toMatchObject({ ok: true, farSnap: false });
    if (!got.ok) return;
    expect(got.snap.edge).toBe(0);
    expect(got.snap.distanceM).toBeGreaterThan(29);
    expect(got.snap.distanceM).toBeLessThan(31);
    expect(got.snap.offsetM).toBeGreaterThan(395);
    expect(got.snap.offsetM).toBeLessThan(405);
    expect(got.snap.point[1]).toBeCloseTo(Y, 5);
  });

  it('says no_road beyond 500 metres and flags a snap farther than 150', () => {
    const { pack } = makePack(rows([way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]])]));
    expect(snapPoint(pack, X + lonDeg(400), Y + deg(520))).toEqual({ ok: false, reason: 'no_road' });
    expect(snapPoint(pack, X + lonDeg(400), Y + deg(480))).toMatchObject({ ok: true, farSnap: true });
    expect(snapPoint(pack, X + lonDeg(400), Y + deg(140))).toMatchObject({ ok: true, farSnap: false });
    expect(snapPoint(pack, X + lonDeg(400), Y + deg(160))).toMatchObject({ ok: true, farSnap: true });
  });

  it('finds roads that only pass through the point cell and ones past the pack edge', () => {
    const { pack } = makePack(rows([way(1, [[1, X, Y], [2, X + lonDeg(8000), Y]])]));
    expect(snapPoint(pack, X + lonDeg(4000), Y + deg(10))).toMatchObject({ ok: true });
    expect(snapPoint(pack, X - lonDeg(200), Y)).toMatchObject({ ok: true });
    expect(snapPoint(pack, X - lonDeg(700), Y)).toEqual({ ok: false, reason: 'no_road' });
    expect(snapPoint(pack, X, Y - deg(700))).toEqual({ ok: false, reason: 'no_road' });
  });

  it('chooses the nearer of two roads', () => {
    const near = way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]]);
    const far = way(2, [[3, X, Y + deg(100)], [4, X + lonDeg(1000), Y + deg(100)]]);
    const link = way(3, [[1, X, Y], [3, X, Y + deg(100)]]);
    const { pack, graph } = makePack(rows([near, far, link]));
    const got = snapPoint(pack, X + lonDeg(500), Y + deg(20));
    expect(got.ok && graph.base.edges[got.snap.edge]?.way).toBe(1);
    const other = snapPoint(pack, X + lonDeg(500), Y + deg(70));
    expect(other.ok && graph.base.edges[other.snap.edge]?.way).toBe(2);
  });

  it('keeps off a motorway when an ordinary road is within 200 metres', () => {
    const motorway = way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]], { cls: 'motorway' });
    const street = way(2, [[3, X, Y + deg(150)], [4, X + lonDeg(1000), Y + deg(150)]]);
    const { pack, graph } = makePack(rows([motorway, street]));
    const got = snapPoint(pack, X + lonDeg(500), Y + deg(30));
    expect(got.ok && graph.base.edges[got.snap.edge]?.way).toBe(2);
    const farStreet = makePack(rows([motorway, way(2, [[3, X, Y + deg(300)], [4, X + lonDeg(1000), Y + deg(300)]])]));
    const stays = snapPoint(farStreet.pack, X + lonDeg(500), Y + deg(30));
    expect(stays.ok && farStreet.graph.base.edges[stays.snap.edge]?.way).toBe(1);
  });

  it('prefers the main network over a close private island unless nothing main is near', () => {
    const main = [
      way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]]),
      way(3, [[2, X + lonDeg(1000), Y], [3, X + lonDeg(1000), Y + deg(1000)]]),
      way(4, [[3, X + lonDeg(1000), Y + deg(1000)], [1, X, Y]]),
    ];
    const island = way(2, [[10, X + lonDeg(100), Y + deg(60)], [11, X + lonDeg(300), Y + deg(60)]]);
    const { pack, graph } = makePack(rows([...main, island]));
    const got = snapPoint(pack, X + lonDeg(200), Y + deg(55));
    expect(got.ok && graph.base.edges[got.snap.edge]?.way).toBe(1);
    const alone = makePack(rows([island]));
    const only = snapPoint(alone.pack, X + lonDeg(200), Y + deg(55));
    expect(only.ok && alone.graph.base.edges[only.snap.edge]?.way).toBe(2);
  });

  it('measures the offset along a bent road', () => {
    const bend = way(1, [[1, X, Y], [2, X + lonDeg(300), Y], [5, X + lonDeg(300), Y + deg(300)]]);
    const { pack } = makePack(rows([bend]));
    const got = snapPoint(pack, X + lonDeg(310), Y + deg(200));
    expect(got.ok && got.snap.offsetM).toBeGreaterThan(495);
    expect(got.ok && got.snap.offsetM).toBeLessThan(505);
  });
});

describe('snapPoint against brute force', () => {
  function web() {
    let seed = 99;
    const rnd = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const nodes = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, k) => [1000 + i * 10 + k, X + lonDeg(i * 700 + rnd() * 120), Y + deg(k * 700 + rnd() * 120)] as [number, number, number]));
    const ways = [];
    for (let k = 0; k < 7; k++) ways.push(way(100 + k, nodes.map((column) => column[k] as [number, number, number])));
    for (let i = 0; i < 7; i++) ways.push(way(200 + i, nodes[i] as [number, number, number][]));
    return { ...makePack(rows(ways)), rnd };
  }

  it('finds the nearest road wherever the point is, in any cell, and says no_road beyond 500 metres', () => {
    const { pack, rnd } = web();
    const mLat = 111_195 / 1e6;
    let found = 0;
    let none = 0;
    for (let round = 0; round < 400; round++) {
      const lng = X + lonDeg(-900 + rnd() * 5800);
      const lat = Y + deg(-900 + rnd() * 5800);
      const px = Math.round(lng * 1e6);
      const py = Math.round(lat * 1e6);
      const mLon = mLat * Math.cos((lat * Math.PI) / 180);
      let best = Infinity;
      for (let e = 0; e < pack.edges.count; e++) best = Math.min(best, project(edgeLine(pack, e), px, py, mLon, mLat).distanceM);
      const got = snapPoint(pack, lng, lat);
      if (best > 500) {
        none++;
        expect(got).toEqual({ ok: false, reason: 'no_road' });
      } else {
        found++;
        expect(got.ok).toBe(true);
        if (got.ok) {
          expect(Math.abs(got.snap.distanceM - best)).toBeLessThan(0.01);
          expect(got.farSnap).toBe(best > 150);
        }
      }
    }
    expect(found).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(5);
  });
});

describe('snapPoint limits', () => {
  const line = (cls: 'residential' | 'motorway' = 'residential') => way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]], { cls });
  const at = (meters: number): [number, number] => [X + lonDeg(500), Y + deg(meters)];

  it('moves a stop up to 500 metres and calls it far from 150', () => {
    const { pack } = makePack(rows([line()]));
    expect(snapPoint(pack, ...at(499.5)).ok).toBe(true);
    expect(snapPoint(pack, ...at(500.5)).ok).toBe(false);
    expect(snapPoint(pack, ...at(149.5))).toMatchObject({ ok: true, farSnap: false });
    expect(snapPoint(pack, ...at(150.5))).toMatchObject({ ok: true, farSnap: true });
  });

  it('prefers a street over a motorway only when the street is within 200 metres', () => {
    const street = (meters: number) => way(2, [[3, X, Y + deg(meters)], [4, X + lonDeg(1000), Y + deg(meters)]]);
    const link = way(3, [[1, X, Y], [3, X, Y + deg(10)]]);
    const near = makePack(rows([line('motorway'), street(210), link]));
    const nearGot = snapPoint(near.pack, ...at(30));
    expect(nearGot.ok && near.graph.base.edges[nearGot.snap.edge]?.way).toBe(2);
    const far = makePack(rows([line('motorway'), way(2, [[3, X, Y + deg(232)], [4, X + lonDeg(1000), Y + deg(232)]]), way(3, [[1, X, Y], [3, X, Y + deg(232)]])]));
    const farGot = snapPoint(far.pack, ...at(30));
    expect(farGot.ok && far.graph.base.edges[farGot.snap.edge]?.way).toBe(1);
  });

  it('prefers the main network only when it is within 100 metres more than the island', () => {
    const mainRoads = (meters: number) => [
      way(1, [[1, X, Y + deg(meters)], [2, X + lonDeg(1000), Y + deg(meters)]]),
      way(3, [[2, X + lonDeg(1000), Y + deg(meters)], [3, X + lonDeg(1000), Y + deg(meters + 500)]]),
      way(4, [[3, X + lonDeg(1000), Y + deg(meters + 500)], [1, X, Y + deg(meters)]]),
    ];
    const island = way(2, [[10, X + lonDeg(100), Y + deg(200)], [11, X + lonDeg(900), Y + deg(200)]]);
    const point: [number, number] = [X + lonDeg(500), Y + deg(205)];
    const inside = makePack(rows([...mainRoads(115), island]));
    const insideGot = snapPoint(inside.pack, ...point);
    expect(insideGot.ok && inside.graph.base.edges[insideGot.snap.edge]?.way).not.toBe(2);
    const outside = makePack(rows([...mainRoads(95), island]));
    const outsideGot = snapPoint(outside.pack, ...point);
    expect(outsideGot.ok && outside.graph.base.edges[outsideGot.snap.edge]?.way).toBe(2);
  });
});

describe('project', () => {
  it('measures the distance to the nearest part of a bent line and how far along it is', () => {
    const mLat = 111_195 / 1e6;
    const line = [0, 0, 100_000, 0, 100_000, 100_000];
    const got = project(line, 50_000, 3_000, mLat, mLat);
    expect(got.distanceM).toBeCloseTo(3_000 * mLat, 6);
    expect(got.along).toBeCloseTo(50_000 * mLat, 6);
    expect(got.total).toBeCloseTo(200_000 * mLat, 6);
    expect(got.x).toBeCloseTo(50_000, 6);
    expect(got.y).toBeCloseTo(0, 6);
    const second = project(line, 103_000, 40_000, mLat, mLat);
    expect(second.along).toBeCloseTo(140_000 * mLat, 6);
    expect(second.x).toBeCloseTo(100_000, 6);
    expect(second.y).toBeCloseTo(40_000, 6);
    expect(project([5, 5, 5, 5], 5, 9, mLat, mLat).distanceM).toBeCloseTo(4 * mLat, 6);
  });
});

describe('snapPoint with impossible coordinates', () => {
  it('answers no_road at once for NaN, infinity and the poles instead of searching forever', () => {
    const { pack } = makePack(rows([way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]])]));
    for (const [lng, lat] of [[X, NaN], [NaN, Y], [X, Infinity], [-Infinity, Y], [X, 90], [X, -90], [X, 89.99], [400, Y], [X, 120]] as [number, number][]) {
      expect(snapPoint(pack, lng, lat)).toEqual({ ok: false, reason: 'no_road' });
    }
  });
});

describe('snapPoint and ferries', () => {
  it('keeps off a ferry line when a road is within range, and uses the ferry when nothing else is', () => {
    const ferry = way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]], { cls: 'ferry', ferry: true, duration: 600 });
    const road = way(2, [[3, X, Y + deg(300)], [4, X + lonDeg(1000), Y + deg(300)]]);
    const link = way(3, [[1, X, Y], [3, X, Y + deg(300)]]);
    const both = makePack(rows([ferry, road, link]), true);
    const got = snapPoint(both.pack, X + lonDeg(500), Y + deg(50));
    expect(got.ok && both.graph.base.edges[got.snap.edge]?.way).toBe(2);
    const alone = makePack(rows([ferry]), true);
    const only = snapPoint(alone.pack, X + lonDeg(500), Y + deg(50));
    expect(only.ok && alone.graph.base.edges[only.snap.edge]?.way).toBe(1);
  });
});
