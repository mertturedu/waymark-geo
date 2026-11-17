import type { LngLat } from '../../src/core/geo/cells';
import { createRouter } from '../../src/core/route/router';
import { arrivalInfo, arrivalTarget, sideOfArrival } from '../../src/core/route/arrival';
import { describeStep, directionsOf } from '../../src/core/route/directions';
import { snapPoint } from '../../src/core/route/snap';
import type { RouteStore } from '../../src/core/ports';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { deg, rows, way } from '../helpers/road-world';
import { makePack } from '../helpers/route-world';

const X = 29;
const Y = 41;
const lonDeg = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);
const at = (x: number, y: number): LngLat => [X + lonDeg(x), Y + deg(y)];

const world = () =>
  rows([
    way(1, [[1, X, Y], [2, X + lonDeg(1000), Y]]),
    way(2, [[3, X, Y + deg(60)], [4, X + lonDeg(1000), Y + deg(60)]]),
    way(3, [[1, X, Y], [3, X, Y + deg(60)]]),
    way(4, [[2, X + lonDeg(1000), Y], [4, X + lonDeg(1000), Y + deg(60)]]),
    way(5, [[5, X + lonDeg(500), Y + deg(60)], [6, X + lonDeg(500), Y + deg(400)]]),
  ]);

const chainB: LngLat[][] = [[at(0, 60), at(1000, 60)]];
const chainA: LngLat[][] = [[at(0, 0), at(1000, 0)]];

describe('snapPoint with a preferred chain', () => {
  it('lands on the chain road although another road is nearer', () => {
    const { pack } = makePack(world());
    const target = at(300, 45);
    const plain = snapPoint(pack, target[0], target[1]);
    expect(plain.ok && plain.snap.point[1]).toBeCloseTo(Y + deg(60), 5);
    const got = snapPoint(pack, target[0], target[1], { lines: chainA });
    expect(got).toMatchObject({ ok: true });
    if (!got.ok) return;
    expect(got.snap.point[1]).toBeCloseTo(Y, 5);
    expect(got.snap.onChain).toBe(true);
    expect(got.snap.distanceM).toBeGreaterThan(44);
    expect(got.snap.distanceM).toBeLessThan(46);
  });

  it('keeps the nearest road when no road lies on the chain within reach', () => {
    const { pack } = makePack(world());
    const target = at(300, 45);
    const far: LngLat[][] = [[at(0, 400), at(1000, 400)]];
    const got = snapPoint(pack, target[0], target[1], { lines: far });
    expect(got.ok && got.snap.onChain).toBeUndefined();
    expect(got.ok && got.snap.point[1]).toBeCloseTo(Y + deg(60), 5);
    expect(snapPoint(pack, target[0], target[1], { lines: [] })).toEqual(snapPoint(pack, target[0], target[1]));
  });

  it('does not take a crossing street for the chain at the junction', () => {
    const { pack } = makePack(world());
    const target = at(503, 68);
    const got = snapPoint(pack, target[0], target[1], { lines: chainB });
    expect(got).toMatchObject({ ok: true });
    if (!got.ok) return;
    expect(got.snap.onChain).toBe(true);
    expect(got.snap.point[1]).toBeCloseTo(Y + deg(60), 5);
    expect(got.snap.point[0]).toBeCloseTo(target[0], 5);
  });

  it('ignores a chain road beyond the reach', () => {
    const { pack } = makePack(world());
    const target = at(300, 45);
    const got = snapPoint(pack, target[0], target[1], { lines: chainA, reachM: 30 });
    expect(got.ok && got.snap.onChain).toBeUndefined();
  });
});

describe('sideOfArrival', () => {
  const east: LngLat[] = [at(0, 0), at(100, 0)];
  it('says left and right of the heading', () => {
    expect(sideOfArrival(east, at(100, 20)).side).toBe('left');
    expect(sideOfArrival(east, at(100, -20)).side).toBe('right');
    expect(sideOfArrival([at(100, 0), at(0, 0)], at(0, 20)).side).toBe('right');
  });

  it('says nothing when the target is on the road or straight ahead', () => {
    expect(sideOfArrival(east, at(102, 1)).side).toBeNull();
    expect(sideOfArrival(east, at(130, 2)).side).toBeNull();
    expect(sideOfArrival([], at(0, 0))).toEqual({ side: null, offM: 0 });
    expect(sideOfArrival([at(0, 0)], at(0, 40)).side).toBeNull();
  });

  it('reports the entrance as the target and rounds the gap', () => {
    const info = arrivalInfo(east, { door: at(100, 60), entrance: at(100, 25) }, true);
    expect(info).toMatchObject({ side: 'left', target: 'entrance', onChain: true });
    expect(info.offM).toBeGreaterThan(24);
    expect(info.offM).toBeLessThan(26);
    expect(arrivalTarget({ door: at(1, 1) })).toEqual(at(1, 1));
    expect(arrivalInfo(east, { door: at(100, 25) }, false).target).toBe('door');
  });
});

const borders = createBorders(encodeBorders([{ plate: '34', rings: [[[[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]]]] }]));
const store = (): RouteStore => {
  const bytes = buildRoutePack(world(), { ferries: false }).bytes;
  return { installed: async () => ['34'], read: async () => bytes };
};

describe('router with an arrival', () => {
  it('ends on the chain road and reports the side', async () => {
    const router = createRouter({ store: store(), borders });
    const door = at(800, 45);
    const plain = await router.route(at(20, 5), door);
    expect(plain.ok && plain.to[1]).toBeCloseTo(Y + deg(60), 5);
    expect(plain.ok && plain.arrival).toBeUndefined();
    const got = await router.route(at(20, 5), door, { arrive: { door, chain: chainA } });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.to[1]).toBeCloseTo(Y, 5);
    expect(got.arrival).toMatchObject({ side: 'left', target: 'door', onChain: true });
    expect(got.arrival?.offM).toBeGreaterThan(44);
  });

  it('aims at the entrance instead of the door', async () => {
    const router = createRouter({ store: store(), borders });
    const door = at(800, 45);
    const entrance = at(250, 20);
    const got = await router.route(at(900, 5), door, { arrive: { door, entrance, chain: chainA } });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.arrival?.target).toBe('entrance');
    expect(got.to[0]).toBeCloseTo(entrance[0], 4);
    expect(got.arrival?.side).toBe('right');
  });

  it('falls back to the nearest road with a note when the chain has no road', async () => {
    const router = createRouter({ store: store(), borders });
    const door = at(800, 45);
    const got = await router.route(at(20, 5), door, { arrive: { door, chain: [[at(0, 900), at(1000, 900)]] } });
    expect(got.ok && got.arrival?.onChain).toBe(false);
    expect(got.ok && got.to[1]).toBeCloseTo(Y + deg(60), 5);
  });
});

describe('matrix with arrivals', () => {
  it('snaps a point onto its chain road', async () => {
    const router = createRouter({ store: store(), borders });
    const points = [at(20, 5), at(800, 45)];
    const plain = await router.matrix(points);
    expect(plain.ok && plain.stops[1]).toMatchObject({ ok: true });
    const got = await router.matrix(points, { arrives: [undefined, { door: points[1] as LngLat, chain: chainA }] });
    expect(got.ok && got.stops[1]?.ok && got.stops[1].point[1]).toBeCloseTo(Y, 5);
    expect(plain.ok && plain.stops[1]?.ok && plain.stops[1].point[1]).toBeCloseTo(Y + deg(60), 5);
  });
});

describe('arrival wording', () => {
  const east: LngLat[] = [at(0, 0), at(200, 0)];
  it('adds the side and the unit to the last step', async () => {
    const steps = await directionsOf(east, 'tr', undefined, { side: 'right', unit: 'C Blok, Giriş 2' });
    expect(steps[steps.length - 1]?.text).toBe('Hedef sağda, C Blok, Giriş 2');
    expect(steps[steps.length - 1]?.side).toBe('right');
    const left = await directionsOf(east, 'en', undefined, { side: 'left' });
    expect(left[left.length - 1]?.text).toBe('Destination on the left');
    const unitOnly = await directionsOf(east, 'de', undefined, { side: null, unit: 'Block C' });
    expect(unitOnly[unitOnly.length - 1]?.text).toBe('Sie haben Ihr Ziel erreicht, Block C');
  });

  it('keeps the old text without a note and leaves other steps alone', async () => {
    const plain = await directionsOf(east, 'tr');
    expect(plain[plain.length - 1]?.text).toBe('Varış noktasına ulaştınız');
    expect((await directionsOf(east, 'tr', undefined, { side: null }))[plain.length - 1]?.text).toBe('Varış noktasına ulaştınız');
    const turn = { kind: 'left' as const, at: at(0, 0), atM: 10, legM: 10 };
    expect(describeStep(turn, 'tr', { side: 'left' })).toEqual(describeStep(turn, 'tr'));
  });
});
