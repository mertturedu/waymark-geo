import { createRouter } from '../../src/core/route/router';
import { MOTORCYCLE_FACTOR } from '../../src/core/route/speeds';
import type { RouteStore } from '../../src/core/ports';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const square = (west: number, south: number, east: number, north: number): [number, number][][][] => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
const borders = createBorders(encodeBorders([
  { plate: '34', rings: square(28.5, 40.5, 29.5, 41.5) },
  { plate: '41', rings: square(29.5, 40.5, 30.5, 41.5) },
  { plate: '54', rings: square(30.5, 40.5, 31.5, 41.5) },
  { plate: '06', rings: square(32.5, 40.5, 33.5, 41.5) },
]));

const lonDeg = (meters: number): number => deg(meters) / Math.cos((41 * Math.PI) / 180);
const pt = (id: number, x: number, y: number): Pt => [id, x, y];
const Y = 41;

function road(first: number, from: number, to: number, ids: number): ReturnType<typeof rows> {
  const steps = 12;
  const points = Array.from({ length: steps + 1 }, (_, i) => pt(ids + i, from + ((to - from) * i) / steps, Y));
  return rows(points.slice(1).map((point, i) => way(first + i, [points[i] as Pt, point])));
}

const packs: Record<string, Uint8Array> = {
  '34': buildRoutePack(road(100, 29.0, 29.5 + lonDeg(8000), 1000), { ferries: false }).bytes,
  '41': buildRoutePack(road(200, 29.5 - lonDeg(8000), 30.5 + lonDeg(8000), 2000), { ferries: false }).bytes,
  '54': buildRoutePack(road(300, 30.5 - lonDeg(8000), 31.0, 3000), { ferries: false }).bytes,
  '06': buildRoutePack(road(400, 32.6, 33.0, 4000), { ferries: false }).bytes,
};

const storeOf = (installed: string[]): RouteStore => ({ installed: async () => installed, read: async (region) => (installed.includes(region) ? (packs[region] ?? null) : null) });
const at = (x: number): [number, number] => [x, Y];

describe('routes across provinces', () => {
  it('joins the packs of neighbouring provinces into one road route', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54']), borders });
    const got = await router.route(at(29.1), at(30.9));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.regions).toEqual(['34', '41', '54']);
    expect(got.distanceM).toBeGreaterThan(148_000);
    expect(got.distanceM).toBeLessThan(154_000);
    expect(got.geometry[0]?.[0]).toBeCloseTo(29.1, 3);
    expect(got.geometry[got.geometry.length - 1]?.[0]).toBeCloseTo(30.9, 3);
    for (let i = 1; i < got.geometry.length; i++) expect((got.geometry[i]?.[0] as number) >= (got.geometry[i - 1]?.[0] as number) - 1e-9).toBe(true);
    expect(got.durationS).toBeGreaterThan(0);
  });

  it('keeps single-province routes as they were', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54']), borders });
    const got = await router.route(at(29.1), at(29.3));
    expect(got.ok && got.regions).toBeUndefined();
    expect(got.ok && got.region).toBe('34');
  });

  it('works in the other direction and across two provinces', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54']), borders });
    const back = await router.route(at(30.9), at(29.1));
    expect(back.ok && back.regions).toEqual(['54', '41', '34']);
    const two = await router.route(at(29.1), at(30.3));
    expect(two.ok && two.regions).toEqual(['34', '41']);
  });

  it('stays a failure when a province on the way is not installed', async () => {
    const router = createRouter({ store: storeOf(['34', '54']), borders });
    const got = await router.route(at(29.1), at(30.9));
    expect(got.ok).toBe(false);
  });

  it('does not join provinces that do not touch each other', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54', '06']), borders });
    const got = await router.route(at(29.1), at(32.9));
    expect(got.ok).toBe(false);
  });

  it('adds the rush hour delay across all the provinces of the way', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54']), borders });
    const free = await router.route(at(29.1), at(30.9));
    const busy = await router.route(at(29.1), at(30.9), { at: Date.UTC(2026, 10, 9) + 5 * 3_600_000 });
    expect(free.ok && busy.ok).toBe(true);
    if (!(free.ok && busy.ok)) return;
    expect(busy.regions).toEqual(['34', '41', '54']);
    expect(busy.traffic?.freeFlowS).toBeCloseTo(free.durationS, 3);
    expect(busy.traffic?.delayS).toBeGreaterThan(0);
    expect(busy.durationS).toBeGreaterThan(free.durationS);
    expect(free.traffic).toBeUndefined();
  });

  it('scales the time for a motorcycle like single routes do', async () => {
    const router = createRouter({ store: storeOf(['34', '41', '54']), borders });
    const car = await router.route(at(29.1), at(30.9));
    const bike = await router.route(at(29.1), at(30.9), { vehicle: 'motorcycle' });
    expect(car.ok && bike.ok).toBe(true);
    if (car.ok && bike.ok) {
      expect(bike.approximate).toBe(true);
      expect(bike.durationS / car.durationS).toBeCloseTo(MOTORCYCLE_FACTOR, 3);
    }
  });
});
