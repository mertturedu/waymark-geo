import { createRouter } from '../../src/core/route/router';
import type { RouteStore } from '../../src/core/ports';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import type { RoadClass } from '../../src/core/route/speeds';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const square = (west: number, south: number, east: number, north: number): [number, number][][][] => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
const borders = createBorders(encodeBorders([{ plate: '34', rings: square(26.5, 40.5, 27.5, 41.5) }]));

const lonDeg = (meters: number): number => deg(meters) / Math.cos((41 * Math.PI) / 180);
const pt = (id: number, x: number, y: number): Pt => [id, x, y];
const X = 27;
const Y = 41;
const rush = Date.UTC(2026, 10, 9) + 5 * 3_600_000;
const night = Date.UTC(2026, 10, 9) + 0 * 3_600_000;

const storeOf = (bytes: Uint8Array): RouteStore => ({ installed: async () => ['34'], read: async () => bytes });

function line(cls: RoadClass): Uint8Array {
  const points = Array.from({ length: 11 }, (_, i) => pt(10 + i, X + lonDeg(2000 * i), Y));
  return buildRoutePack(rows(points.slice(1).map((point, i) => way(100 + i, [points[i] as Pt, point], { cls }))), { ferries: false }).bytes;
}

function twoRoads(): Uint8Array {
  const a = pt(1, X, Y);
  const b = pt(2, X + lonDeg(20000), Y);
  const middle = (i: number): Pt => pt(30 + i, X + lonDeg(2000 * i), Y);
  const direct = Array.from({ length: 11 }, (_, i) => (i === 0 ? a : i === 10 ? b : middle(i)));
  const apex = (i: number): Pt => pt(60 + i, X + lonDeg(2000 * i), Y + deg(i <= 5 ? 800 * i : 800 * (10 - i)));
  const around = Array.from({ length: 11 }, (_, i) => (i === 0 ? a : i === 10 ? b : apex(i)));
  const all = [
    ...direct.slice(1).map((point, i) => way(100 + i, [direct[i] as Pt, point], { cls: 'trunk', speed: '60' })),
    ...around.slice(1).map((point, i) => way(200 + i, [around[i] as Pt, point], { cls: 'tertiary', speed: '60' })),
  ];
  return buildRoutePack(rows(all), { ferries: false }).bytes;
}

const from: [number, number] = [X + lonDeg(200), Y];
const to: [number, number] = [X + lonDeg(19800), Y];

describe('routes with typical traffic', () => {
  it('leaves everything as it was when no time is given', async () => {
    const got = await createRouter({ store: storeOf(line('motorway')), borders }).route(from, to);
    expect(got.ok && got.traffic).toBeUndefined();
  });

  it('says which parts of the route are slow so a map can colour them', async () => {
    const router = createRouter({ store: storeOf(line('motorway')), borders });
    const busy = await router.route(from, to, { at: rush });
    const quiet = await router.route(from, to, { at: night });
    expect(busy.ok && quiet.ok).toBe(true);
    if (!(busy.ok && quiet.ok)) return;
    const spans = busy.traffic?.spans ?? [];
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]?.from).toBe(0);
    expect(spans[spans.length - 1]?.to).toBeCloseTo(1, 6);
    expect(spans.every((span, i) => i === 0 || span.from === (spans[i - 1] as { to: number }).to)).toBe(true);
    expect(spans.some((span) => span.band !== 'smooth')).toBe(true);
    expect(quiet.traffic?.spans?.every((span) => span.band === 'smooth')).toBe(true);
  });

  it('adds a delay in the rush hour and none at night', async () => {
    const router = createRouter({ store: storeOf(line('motorway')), borders });
    const free = await router.route(from, to);
    const busy = await router.route(from, to, { at: rush });
    const quiet = await router.route(from, to, { at: night });
    expect(free.ok && busy.ok && quiet.ok).toBe(true);
    if (!(free.ok && busy.ok && quiet.ok)) return;
    expect(busy.traffic?.freeFlowS).toBeCloseTo(free.durationS, 3);
    expect(busy.durationS).toBeGreaterThan(free.durationS * 1.3);
    expect(busy.durationS).toBeLessThan(free.durationS * 1.6);
    expect(busy.durationS).toBeCloseTo((busy.traffic?.freeFlowS ?? 0) + (busy.traffic?.delayS ?? 0), 3);
    expect(busy.traffic?.index).toBeGreaterThan(0.8);
    expect(quiet.durationS).toBeLessThan(free.durationS * 1.05);
    expect(busy.distanceM).toBeCloseTo(free.distanceM, 0);
  });

  it('delays big roads more than small streets', async () => {
    const delay = async (cls: RoadClass): Promise<number> => {
      const got = await createRouter({ store: storeOf(line(cls)), borders }).route(from, to, { at: rush });
      return got.ok ? (got.traffic?.delayS ?? 0) / Math.max(1, got.traffic?.freeFlowS ?? 1) : -1;
    };
    expect(await delay('motorway')).toBeGreaterThan(await delay('primary'));
    expect(await delay('primary')).toBeGreaterThan(await delay('residential'));
  });

  it('takes a calmer parallel road when that is quicker in the rush hour', async () => {
    const jammed = (at: number) => (lat: number) => (at === rush && Math.abs(lat - Y) < 0.001 ? 0.7 : 0);
    const router = createRouter({ store: storeOf(twoRoads()), borders, traffic: (_region, at) => jammed(at) });
    const free = await router.route(from, to, { at: night });
    const busy = await router.route(from, to, { at: rush });
    expect(free.ok && busy.ok).toBe(true);
    if (!(free.ok && busy.ok)) return;
    expect(free.traffic?.detour).toBe(false);
    expect(busy.traffic?.detour).toBe(true);
    expect(busy.distanceM).toBeGreaterThan(free.distanceM);
    const direct = (free.geometry.reduce((most, [, y]) => Math.max(most, Math.abs(y - Y)), 0));
    const around = (busy.geometry.reduce((most, [, y]) => Math.max(most, Math.abs(y - Y)), 0));
    expect(direct).toBeLessThan(0.001);
    expect(around).toBeGreaterThan(0.02);
  });

  it('keeps the motorcycle factor on both the free-flow and the delayed time', async () => {
    const router = createRouter({ store: storeOf(line('primary')), borders });
    const car = await router.route(from, to, { at: rush });
    const bike = await router.route(from, to, { at: rush, vehicle: 'motorcycle' });
    expect(car.ok && bike.ok).toBe(true);
    if (car.ok && bike.ok) expect(bike.durationS / car.durationS).toBeCloseTo(0.85, 3);
  });

  it('takes its slowdowns from the traffic source it is given', async () => {
    const calm = await createRouter({ store: storeOf(line('motorway')), borders, traffic: () => () => 0 }).route(from, to, { at: rush });
    const slow = await createRouter({ store: storeOf(line('motorway')), borders, traffic: () => () => 0.5 }).route(from, to, { at: rush });
    expect(calm.ok && slow.ok).toBe(true);
    if (!(calm.ok && slow.ok)) return;
    expect(calm.traffic?.delayS).toBe(0);
    expect(slow.durationS / (slow.traffic?.freeFlowS ?? 1)).toBeGreaterThan(1.9);
    expect(slow.durationS / (slow.traffic?.freeFlowS ?? 1)).toBeLessThanOrEqual(2);
    expect(slow.traffic?.spans?.every((span) => span.band === 'jam')).toBe(true);
  });
});
