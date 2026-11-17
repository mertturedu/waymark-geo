import { createRouter } from '../../src/core/route/router';
import type { RouteStore } from '../../src/core/ports';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { deg, rows, way, type Pt } from '../helpers/road-world';

const square = (west: number, south: number, east: number, north: number): [number, number][][][] => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]];
const borders = createBorders(encodeBorders([
  { plate: '34', rings: square(28.5, 40.5, 29.5, 41.5) },
  { plate: '41', rings: square(29.5, 40.5, 30.5, 41.5) },
]));

const lonDeg = (meters: number, lat = 41): number => deg(meters) / Math.cos((lat * Math.PI) / 180);
const pt = (id: number, x: number, y: number): Pt => [id, x, y];

function network(): ReturnType<typeof rows> {
  const X = 29;
  const Y = 41;
  const loop = [
    way(1, [pt(1, X, Y), pt(2, X + lonDeg(2000), Y)]),
    way(2, [pt(2, X + lonDeg(2000), Y), pt(3, X + lonDeg(2000), Y + deg(2000))]),
    way(3, [pt(3, X + lonDeg(2000), Y + deg(2000)), pt(4, X, Y + deg(2000))]),
    way(4, [pt(4, X, Y + deg(2000)), pt(1, X, Y)]),
    way(5, [pt(2, X + lonDeg(2000), Y), pt(6, 29.5 + lonDeg(3000), Y)]),
  ];
  const island = way(9, [pt(20, X + lonDeg(500), Y - deg(400)), pt(21, X + lonDeg(900), Y - deg(400))]);
  return rows([...loop, island]);
}

type Fixture = { store: RouteStore; reads: string[]; bytes: Uint8Array };

function fixture(options: { installed?: string[]; bytes?: Uint8Array } = {}): Fixture {
  const bytes = options.bytes ?? buildRoutePack(network(), { ferries: false }).bytes;
  const reads: string[] = [];
  const installed = options.installed ?? ['34'];
  return {
    bytes,
    reads,
    store: {
      installed: async () => installed,
      read: async (region) => {
        reads.push(region);
        return installed.includes(region) ? bytes : null;
      },
    },
  };
}

const at = (x: number, y: number): [number, number] => [x, y];
const X = 29;
const Y = 41;

describe('createRouter.route', () => {
  it('routes between two places and gives time, distance and a line that ends where the stops are', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const got = await router.route(at(X + lonDeg(200), Y + deg(20)), at(X + lonDeg(1950), Y + deg(1500)));
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.region).toBe('34');
    expect(got.distanceM).toBeGreaterThan(3000);
    expect(got.distanceM).toBeLessThan(5000);
    expect(got.durationS).toBeGreaterThan(300);
    expect(got.geometry[0]?.[0]).toBeCloseTo(got.from[0], 5);
    expect(got.geometry[got.geometry.length - 1]?.[1]).toBeCloseTo(got.to[1], 5);
    expect(got.warnings).toEqual([]);
  });

  it('uses a neighbour pack for a start just across the border and refuses one that is too far', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const near = await router.route(at(29.5 + lonDeg(2800), Y), at(X + lonDeg(1000), Y));
    expect(near.ok).toBe(true);
    expect(await router.route(at(29.5 + lonDeg(15000), Y), at(X + lonDeg(1000), Y))).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
    expect(await createRouter({ store: fixture({ installed: [] }).store, borders }).route(at(X, Y), at(X + 0.01, Y))).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
  });

  it('names the stop that has no road, lies outside the pack or cannot be reached', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const start = at(X + lonDeg(200), Y + deg(10));
    expect(await router.route(start, at(X + lonDeg(1000), Y + deg(4000)))).toEqual({ ok: false, code: 'no_road', stop: 1 });
    expect(await router.route(start, at(31.5, Y))).toEqual({ ok: false, code: 'outside_region', stop: 1 });
    expect(await router.route(start, at(X + lonDeg(700), Y - deg(400)))).toEqual({ ok: false, code: 'disconnected', stop: 1 });
    expect(await router.route(at(X + lonDeg(1000), Y + deg(4000)), start)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
  });

  it('warns about a stop that had to be moved far to reach a road', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const got = await router.route(at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1000), Y + deg(2000) + deg(300)));
    expect(got.ok && got.warnings).toEqual([{ stop: 1, code: 'far_snap' }]);
  });

  it('survives a damaged pack and reports it', async () => {
    const good = fixture().bytes;
    const router = createRouter({ store: fixture({ bytes: good.slice(0, 80) }).store, borders });
    expect(await router.route(at(X, Y), at(X + 0.01, Y))).toEqual({ ok: false, code: 'PACK_DAMAGED' });
  });
});

describe('createRouter on damaged packs', () => {
  it('turns every failure inside a pack into a result and never throws (property)', async () => {
    const good = fixture().bytes;
    let seed = 7;
    const rnd = (): number => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const codes = new Set<string>();
    for (let round = 0; round < 300; round++) {
      const bytes = good.slice();
      for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) bytes[44 + Math.floor(rnd() * (bytes.length - 44))] = Math.floor(rnd() * 256);
      const router = createRouter({ store: fixture({ bytes }).store, borders });
      const a = at(X + lonDeg(200), Y + deg(10));
      const b = at(X + lonDeg(1500), Y + deg(1500));
      const result = await router.route(a, b);
      const table = await router.matrix([a, b]);
      codes.add(result.ok ? 'ok' : result.code);
      codes.add(table.ok ? 'ok' : table.code);
    }
    expect(codes.has('ok')).toBe(true);
    expect(codes.has('PACK_DAMAGED')).toBe(true);
    for (const code of codes) expect(['ok', 'PACK_DAMAGED', 'START_OUTSIDE_REGION', 'no_road', 'outside_region', 'disconnected']).toContain(code);
  });

  it('answers an empty list of points with a clear refusal', async () => {
    const router = createRouter({ store: fixture().store, borders });
    expect(await router.matrix([])).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
  });
});

describe('createRouter vehicle', () => {
  it('gives a motorcycle the same road in a shorter, approximate time', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const from = at(X + lonDeg(200), Y + deg(10));
    const to = at(X + lonDeg(1950), Y + deg(1500));
    const car = await router.route(from, to);
    const bike = await router.route(from, to, { vehicle: 'motorcycle' });
    if (!car.ok || !bike.ok) throw new Error('route');
    expect(car.approximate).toBe(false);
    expect(bike.approximate).toBe(true);
    expect(bike.distanceM).toBe(car.distanceM);
    expect(bike.durationS).toBeCloseTo(car.durationS * 0.85, 6);
    const table = await router.matrix([from, to], { vehicle: 'motorcycle' });
    const plain = await router.matrix([from, to]);
    if (!table.ok || !plain.ok) throw new Error('matrix');
    expect(table.approximate).toBe(true);
    expect(plain.approximate).toBe(false);
    expect(table.durationS[0]?.[1]).toBeCloseTo((plain.durationS[0]?.[1] as number) * 0.85, 6);
  });
});

describe('createRouter memory', () => {
  const clock = () => {
    let now = 0;
    const waiting: { at: number; done: () => void }[] = [];
    return {
      now: () => now,
      sleep: (ms: number) => new Promise<void>((resolve) => waiting.push({ at: now + ms, done: resolve })),
      advance: async (ms: number) => {
        now += ms;
        for (const w of waiting.filter((x) => x.at <= now)) w.done();
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
  };

  it('loads a pack once for simultaneous requests and drops it after the idle time', async () => {
    const f = fixture();
    const c = clock();
    const router = createRouter({ store: f.store, borders, clock: c, idleMs: 1000 });
    const a = at(X + lonDeg(200), Y + deg(10));
    const b = at(X + lonDeg(1500), Y + deg(10));
    await Promise.all([router.route(a, b), router.route(b, a)]);
    expect(f.reads).toEqual(['34']);
    await c.advance(500);
    await router.route(a, b);
    await c.advance(700);
    await router.route(a, b);
    expect(f.reads).toEqual(['34']);
    await c.advance(2000);
    await router.route(a, b);
    expect(f.reads).toEqual(['34', '34']);
  });

  it('forgets a pack that the store says changed', async () => {
    const f = fixture();
    let notify: (region: string) => void = () => undefined;
    const store: RouteStore = { ...f.store, onChange: (listener) => { notify = listener; return () => undefined; } };
    const router = createRouter({ store, borders });
    await router.route(at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1500), Y + deg(10)));
    notify('34');
    await router.route(at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1500), Y + deg(10)));
    expect(f.reads).toEqual(['34', '34']);
  });
});

describe('createRouter.matrix', () => {
  it('fills a table of times and distances and marks stops that cannot be used', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const points: [number, number][] = [
      at(X + lonDeg(200), Y + deg(10)),
      at(X + lonDeg(1950), Y + deg(1500)),
      at(X + lonDeg(1000), Y + deg(4000)),
      at(X + lonDeg(700), Y - deg(400)),
    ];
    const got = await router.matrix(points);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.stops.map((s) => (s.ok ? 'ok' : s.reason))).toEqual(['ok', 'ok', 'no_road', 'disconnected']);
    expect(got.durationS[0]?.[0]).toBe(0);
    expect(got.durationS[0]?.[1]).toBeGreaterThan(0);
    expect(got.durationS[1]?.[0]).toBeGreaterThan(0);
    expect(got.durationS[0]?.[2]).toBeNull();
    expect(got.distanceM[0]?.[1]).toBeGreaterThan(2000);
  });
});

describe('createRouter choice of pack and failures', () => {
  const twoPacks = (damaged: string[] = []): RouteStore => {
    const good = buildRoutePack(network(), { ferries: false }).bytes;
    const east = buildRoutePack(rows([way(1, [pt(1, 29.5 + lonDeg(500), Y + deg(5000)), pt(2, 29.5 + lonDeg(3000), Y + deg(5000))])]), { ferries: false }).bytes;
    return {
      installed: async () => ['34', '41'],
      read: async (region) => (damaged.includes(region) ? good.slice(0, 80) : region === '34' ? good : east),
    };
  };

  it('tries the next pack when the first cannot be read, and reports damage when none can', async () => {
    const start = at(29.5 + lonDeg(700), Y + deg(5000));
    const target = at(29.5 + lonDeg(2000), Y + deg(5000));
    const router = createRouter({ store: twoPacks(['41']), borders });
    expect(await router.route(start, target)).toEqual({ ok: false, code: 'PACK_DAMAGED' });
    expect(await createRouter({ store: twoPacks(['34', '41']), borders }).route(start, target)).toEqual({ ok: false, code: 'PACK_DAMAGED' });
    const own = await createRouter({ store: twoPacks(['34']), borders }).route(start, target);
    expect(own).toMatchObject({ ok: true, region: '41' });
  });

  it('falls back to the neighbour when the own pack has no road near the start', async () => {
    const router = createRouter({ store: twoPacks(), borders });
    const got = await router.route(at(29.5 + lonDeg(700), Y), at(X + lonDeg(1500), Y));
    expect(got).toMatchObject({ ok: true, region: '34' });
  });

  it('names a stop of the table that has no road and its place in the list', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const points: [number, number][] = [at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1000), Y + deg(4000)), at(X + lonDeg(1950), Y + deg(1500)), at(X + lonDeg(1000), Y + deg(2300))];
    const got = await router.matrix(points);
    if (!got.ok) throw new Error('matrix');
    expect(got.stops[1]).toEqual({ ok: false, reason: 'no_road' });
    expect(got.stops[2]).toMatchObject({ ok: true, warnings: [] });
    expect(got.stops[3]).toMatchObject({ ok: true, warnings: [{ stop: 3, code: 'far_snap' }] });
    expect(got.durationS[1]?.every((v) => v === null)).toBe(true);
    expect(got.durationS.every((row) => row[1] === null)).toBe(true);
    expect(got.distanceM[0]?.[0]).toBe(0);
    expect(got.distanceM[0]?.[2]).toBeGreaterThan(2000);
    expect(got.distanceM[0]?.[1]).toBeNull();
    expect(got.distanceM[0]?.[2]).toBe((await router.route(points[0] as [number, number], points[2] as [number, number]) as { distanceM: number }).distanceM);
  });

  it('tells both ends apart when each had to be moved far', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const got = await router.route(at(X + lonDeg(200), Y + deg(300)), at(X + lonDeg(1000), Y + deg(2300)));
    expect(got).toMatchObject({ ok: true, warnings: [{ stop: 0, code: 'far_snap' }, { stop: 1, code: 'far_snap' }] });
  });

  it('answers a stop before the start that has no road with that stop number', async () => {
    const router = createRouter({ store: fixture().store, borders });
    expect(await router.route(at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(5000), Y + deg(5000)))).toEqual({ ok: false, code: 'no_road', stop: 1 });
  });

  it('draws the line as whole coordinates and keeps car times', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const got = await router.route(at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1950), Y + deg(1500)));
    if (!got.ok) throw new Error('route');
    for (const [x, y] of got.geometry) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    expect(got.geometry.length).toBeGreaterThan(2);
    expect(got.durationS).toBeGreaterThan(got.distanceM / 25);
    expect(got.durationS).toBeLessThan(got.distanceM / 1);
  });
});

describe('createRouter invalidation and idle timing', () => {
  const clockOf = () => {
    let now = 0;
    const waiting: { at: number; done: () => void }[] = [];
    return {
      now: () => now,
      sleep: (ms: number) => new Promise<void>((resolve) => waiting.push({ at: now + ms, done: resolve })),
      advance: async (ms: number) => {
        now += ms;
        for (const w of waiting.filter((x) => x.at <= now)) {
          waiting.splice(waiting.indexOf(w), 1);
          w.done();
        }
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      },
    };
  };
  const a = at(X + lonDeg(200), Y + deg(10));
  const b = at(X + lonDeg(1500), Y + deg(10));

  it('forgets one pack or all of them on request', async () => {
    const f = fixture();
    const router = createRouter({ store: f.store, borders });
    await router.route(a, b);
    router.invalidate('41');
    await router.route(a, b);
    expect(f.reads).toEqual(['34']);
    router.invalidate('34');
    await router.route(a, b);
    expect(f.reads).toEqual(['34', '34']);
    router.invalidate();
    await router.route(a, b);
    expect(f.reads).toEqual(['34', '34', '34']);
  });

  it('drops a pack exactly when it has been idle for the whole idle time, and not before', async () => {
    const f = fixture();
    const c = clockOf();
    const router = createRouter({ store: f.store, borders, clock: c, idleMs: 1000 });
    await router.route(a, b);
    await c.advance(999);
    await router.route(a, b);
    expect(f.reads).toEqual(['34']);
    await c.advance(999);
    await router.route(a, b);
    expect(f.reads).toEqual(['34']);
    await c.advance(1000);
    await router.route(a, b);
    expect(f.reads).toEqual(['34', '34']);
  });

  it('drops a pack that was last used partway through the wait as soon as the rest of the wait is over', async () => {
    const f = fixture();
    const c = clockOf();
    const router = createRouter({ store: f.store, borders, clock: c, idleMs: 1000 });
    await router.route(a, b);
    await c.advance(500);
    await router.route(a, b);
    await c.advance(500);
    await router.route(a, b);
    expect(f.reads).toEqual(['34']);
    await c.advance(1000);
    await router.route(a, b);
    expect(f.reads).toEqual(['34', '34']);
  });

  it('keeps asking the store again after it could not read a pack', async () => {
    let calls = 0;
    const store: RouteStore = { installed: async () => ['34'], read: async () => (calls++, null) };
    const router = createRouter({ store, borders });
    await router.route(a, b);
    await router.route(a, b);
    expect(calls).toBe(2);
    const failing: RouteStore = { installed: async () => ['34'], read: async () => { throw new Error('disk'); } };
    expect(await createRouter({ store: failing, borders }).route(a, b)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
  });
});

describe('createRouter with a stop that only a neighbour pack covers', () => {
  const store = (): RouteStore => {
    const pack34 = buildRoutePack(rows([way(1, [pt(1, 29.4, Y), pt(2, 29.52, Y)])]), { ferries: false }).bytes;
    const pack41 = buildRoutePack(rows([way(1, [pt(1, 29.4, Y), pt(2, 29.95, Y)])]), { ferries: false }).bytes;
    return { installed: async () => ['34', '41'], read: async (region) => (region === '34' ? pack34 : pack41) };
  };

  it('uses the pack that reaches both stops, whichever way the trip goes', async () => {
    const router = createRouter({ store: store(), borders });
    expect(await router.route(at(29.42, Y), at(29.8, Y))).toMatchObject({ ok: true, region: '41' });
    expect(await router.route(at(29.8, Y), at(29.42, Y))).toMatchObject({ ok: true, region: '41' });
    expect(await router.route(at(29.42, Y), at(29.45, Y))).toMatchObject({ ok: true, region: '34' });
  });

  it('names the failure of the pack that covers the stop rather than one that does not', async () => {
    const router = createRouter({ store: store(), borders });
    expect(await router.route(at(29.42, Y), at(29.8, Y + 0.3))).toEqual({ ok: false, code: 'no_road', stop: 1 });
    expect(await router.route(at(29.42, Y), at(31.5, Y))).toEqual({ ok: false, code: 'outside_region', stop: 1 });
  });

  it('fills the table from the pack that reaches most of the stops', async () => {
    const router = createRouter({ store: store(), borders });
    const got = await router.matrix([at(29.42, Y), at(29.45, Y), at(29.8, Y)]);
    if (!got.ok) throw new Error('matrix');
    expect(got.region).toBe('41');
    expect(got.stops.map((s) => s.ok)).toEqual([true, true, true]);
    const tie = await router.matrix([at(29.42, Y), at(29.45, Y)]);
    expect(tie.ok && tie.region).toBe('34');
  });
});

describe('createRouter robustness', () => {
  it('answers impossible coordinates with a clean failure for either end and in tables', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const good = at(X + lonDeg(200), Y + deg(10));
    expect(await router.route(good, [29.005, NaN])).toEqual({ ok: false, code: 'outside_region', stop: 1 });
    expect(await router.route(good, [29.005, 90])).toMatchObject({ ok: false, stop: 1 });
    expect(await router.route([NaN, NaN], good)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
    const table = await router.matrix([good, [X, Infinity]]);
    expect(table.ok && table.stops[1]).toEqual({ ok: false, reason: 'outside_region' });
  });

  it('removes a disconnected stop from the whole table, its own diagonal included', async () => {
    const router = createRouter({ store: fixture().store, borders });
    const got = await router.matrix([at(X + lonDeg(200), Y + deg(10)), at(X + lonDeg(1950), Y + deg(1500)), at(X + lonDeg(700), Y - deg(400))]);
    if (!got.ok) throw new Error('matrix');
    expect(got.stops[2]).toEqual({ ok: false, reason: 'disconnected' });
    expect(got.durationS[2]).toEqual([null, null, null]);
    expect(got.distanceM[2]).toEqual([null, null, null]);
    expect(got.durationS.map((row) => row[2])).toEqual([null, null, null]);
    expect(got.distanceM.map((row) => row[2])).toEqual([null, null, null]);
    expect(got.durationS[0]?.[1]).toBeGreaterThan(0);
  });
});
