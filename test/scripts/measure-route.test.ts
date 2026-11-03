import { buildBaseGraph } from '../../pipeline/build/route-graph';
import { applyRestrictions } from '../../pipeline/build/route-turns';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { heavyAvoidance, checkExact, checkOneway, checkTurns, measureTurns, compareReference, legWeight, loadPlate, measureConnectivity, measureExact, measureHermes, measureMemory, measureOneway, measureReference, measureSizes, measureSpeed, timeQueries, randomOf, randomSnap, runCheck } from '../../scripts/measure-route';
import { deg, rows, way, type Pt } from '../helpers/road-world';
import { osmXml, routeFixture } from '../helpers/route-packs';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);
const at = (i: number, j: number): Pt => [100 + i * 10 + j, X + lon(i * 250), Y + deg(j * 250)];

function city(): ReturnType<typeof rows> {
  const ways = [];
  for (let j = 0; j < 6; j++) ways.push(way(100 + j, Array.from({ length: 6 }, (_, i) => at(i, j)), { oneway: j % 3 === 1 ? 'f' : '', cls: j === 5 ? 'primary' : 'residential' }));
  for (let i = 0; i < 6; i++) ways.push(way(200 + i, Array.from({ length: 6 }, (_, j) => at(i, j)), { oneway: i % 3 === 2 ? 'b' : '' }));
  const rule = { id: 1, kind: 'no' as const, restriction: 'no_left_turn', from: 200, to: 101, via: [{ n: 101 }] };
  return rows(ways, [rule]);
}

describe('randomOf', () => {
  it('repeats for the same seed and spreads over the unit interval', () => {
    const a = randomOf(5);
    const b = randomOf(5);
    const first = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(first).size).toBe(5);
    expect(randomOf(0)()).toBeGreaterThanOrEqual(0);
  });
});

describe('checks on a small city', () => {
  it('finds no difference between the hierarchy and plain Dijkstra, and every drawn route adds up', async () => {
    const ctx = await routeFixture({ '34': city() });
    const loaded = await loadPlate(ctx, '34');
    const counts = checkExact(loaded, 11);
    expect(counts.pairs).toBe(20_000);
    expect(counts.wrong).toBe(0);
    expect(counts.badLegs).toBe(0);
    expect(counts.legs).toBe(200);
  });

  it('notices a hierarchy that has been damaged', async () => {
    const ctx = await routeFixture({ '34': city() });
    const loaded = await loadPlate(ctx, '34');
    for (let i = 0; i < loaded.pack.hierarchy.upW.length; i++) loaded.pack.hierarchy.upW[i] = (loaded.pack.hierarchy.upW[i] as number) + 1;
    expect(checkExact(loaded, 11).wrong).toBeGreaterThan(0);
  });

  it('finds no route against a one-way street, and notices when the raw data says otherwise', async () => {
    const ctx = await routeFixture({ '34': city() });
    const loaded = await loadPlate(ctx, '34');
    const ok = checkOneway(loaded, 3, 300);
    expect(ok.found).toBeGreaterThan(100);
    expect(ok.against).toBe(0);
    for (const w of loaded.rows.ways) w.oneway = w.oneway === 'f' ? 'b' : w.oneway === 'b' ? 'f' : w.oneway;
    expect(checkOneway(loaded, 3, 300).against).toBeGreaterThan(0);
  });

  it('refuses a leg whose arcs do not join up', async () => {
    const ctx = await routeFixture({ '34': city() });
    const { pack } = await loadPlate(ctx, '34');
    const a = randomSnap(pack, randomOf(1));
    const b = randomSnap(pack, randomOf(9));
    expect(legWeight(pack, a, b, [0, 2 * (pack.edges.count - 1), 0])).toBeNull();
    expect(legWeight(pack, a, b, [])).toBeNull();
  });
});

describe('summaries', () => {
  it('reports the exact check and the one-way check as passing for a sound pack', async () => {
    const ctx = await routeFixture({ '34': city() });
    const exact = await measureExact(ctx);
    expect(exact).toMatchObject({ check: 'exact', pass: true, measured: '20000 çift, 0 fark, 0 tutmayan yol' });
    expect(exact.report).toContain('| 34 |');
    const oneway = await measureOneway(ctx);
    expect(oneway.pass).toBe(true);
    expect(oneway.measured).toMatch(/ters yönde 0 parça/);
  });

  it('weighs the pack files against the size limits', async () => {
    const ctx = await routeFixture({ '34': city(), '06': city() });
    const sizes = await measureSizes(ctx);
    expect(sizes.pass).toBe(true);
    expect(sizes.measured).toMatch(/İstanbul 0\.\d MB/);
    const none = await measureSizes(await routeFixture({ '06': city() }));
    expect(none.pass).toBe(false);
  });

  it('passes the connectivity check for a network that hangs together and fails one that is cut in two', async () => {
    const ctx = await routeFixture({ '34': city() });
    const sound = await measureConnectivity(ctx);
    expect(sound.pass).toBe(true);
    const island = (i: number, j: number): Pt => [5000 + i * 10 + j, X + 1 + lon(i * 250), Y + 1 + deg(j * 250)];
    const extra = [];
    for (let j = 0; j < 4; j++) extra.push(way(300 + j, Array.from({ length: 4 }, (_, i) => island(i, j))));
    for (let i = 0; i < 4; i++) extra.push(way(400 + i, Array.from({ length: 4 }, (_, j) => island(i, j))));
    const base = city();
    const split = await measureConnectivity(await routeFixture({ '34': rows([...base.ways, ...extra], base.rules) }));
    expect(split.pass).toBe(false);
    expect(split.measured).toMatch(/en düşük yüzde \d+\.\d+; altında 1 il: 34/);
  });

  it('knows the check names', async () => {
    expect(await runCheck('nothing')).toBeNull();
    const ctx = await routeFixture({ '34': city() });
    expect((await runCheck('sizes', ctx))?.check).toBe('sizes');
    expect(buildBaseGraph(city(), { ferries: true }).edges.length).toBeGreaterThan(0);
  });
});

describe('reference comparison', () => {
  it('agrees with an independently built graph within the rounding allowance', async () => {
    const world = city();
    const ctx = await routeFixture({ '34': { ...world, rules: [] } });
    const clip = join(ctx.root, 'clip.osm');
    writeFileSync(clip, osmXml(world));
    const got = await measureReference(ctx, { clipFile: () => clip });
    expect(got).toMatchObject({ check: 'reference', pass: true });
    expect(got.measured).toBe('2000 çift, payı aşan 0');
    expect(got.report).toContain('| 34 | 2000 |');
  });

  it('shows a difference when the two graphs do not describe the same streets', async () => {
    const world = city();
    const ctx = await routeFixture({ '34': { ...world, rules: [] } });
    const other = { ...world, ways: world.ways.map((w) => (w.id === 100 ? { ...w, cls: 'motorway' as const } : w)) };
    const clip = join(ctx.root, 'clip.osm');
    writeFileSync(clip, osmXml(other));
    const { row, outside } = compareReference(ctx, '34', { clipFile: () => clip });
    expect(row.outside).toBeGreaterThan(0);
    expect(outside[0]).toMatch(/^34: \d+ → \d+: SDK/);
  });
});

describe('speed and memory', () => {
  it('times single routes and 50 x 50 tables', async () => {
    const ctx = await routeFixture({ '34': city() });
    const n = timeQueries(await loadPlate(ctx, '34'), 4, 50);
    expect(n.routeP95).toBeGreaterThan(0);
    expect(n.routeMedian).toBeLessThanOrEqual(n.routeP95);
    expect(n.matrixWorst).toBeGreaterThanOrEqual(n.matrixMedian);
    const got = await measureSpeed({ ...ctx, plates: ['34'] });
    expect(got.pass).toBe(true);
    expect(got.report).toContain('| 34 |');
  });

  it('runs the table inside Hermes and reports its time', async () => {
    const ctx = await routeFixture({ '34': city() });
    const got = await measureHermes(ctx);
    expect(got.pass).toBe(true);
    expect(got.measured).toMatch(/^matris 50x50 en kötü \d+ ms \(sınır 2000\), okuma \d+ ms, tek rota p95 \d+ ms$/);
    await expect(measureHermes(ctx, '06')).rejects.toThrow(/rota paketi yok/);
  }, 120_000);

  it('counts the memory a loaded pack takes in a fresh process', async () => {
    const ctx = await routeFixture({ '34': city() });
    const got = await measureMemory(ctx);
    expect(got.pass).toBe(true);
    expect(got.measured).toMatch(/^34 paketi yüklüyken artış -?\d+\.\d MB \(sınır 80\)$/);
  }, 120_000);
});

describe('turn checks', () => {
  const X0 = 29;
  const Y0 = 41;
  const D = 0.001;
  const C: Pt = [10, X0, Y0];
  const crossing = (rule: ReturnType<typeof rows>['rules']): ReturnType<typeof rows> => {
    const ring = [
      way(1, [[12, X0, Y0 - D], C], { oneway: 'f' }),
      way(2, [C, [11, X0, Y0 + D]], { oneway: 'f' }),
      way(3, [[14, X0 - D, Y0], C], { oneway: 'b' }),
      way(4, [C, [13, X0 + D, Y0]], { oneway: 'f' }),
      way(5, [[11, X0, Y0 + D], [15, X0 - D, Y0 + D / 2]], { oneway: 'f' }),
      way(6, [[15, X0 - D, Y0 + D / 2], C], { oneway: 'f' }),
    ];
    return rows(ring, rule);
  };
  const ban = { id: 7, kind: 'no' as const, restriction: 'no_left_turn', from: 1, to: 3, via: [{ n: 10 }] };
  const must = { id: 8, kind: 'only' as const, restriction: 'only_straight_on', from: 1, to: 2, via: [{ n: 10 }] };

  it('finds no banned turn in routes made with the rules in place', async () => {
    const ctx = await routeFixture({ '34': crossing([ban, must]) });
    const got = checkTurns(await loadPlate(ctx, '34'));
    expect(got).toMatchObject({ rules: 2, violations: 0 });
    expect(got.tested).toBeGreaterThan(1);
  });

  it('notices the banned turn when the pack was built without the rules', async () => {
    const ctx = await routeFixture({ '34': crossing([]) });
    const loaded = await loadPlate(ctx, '34');
    loaded.rows.rules.push(ban, must);
    const got = checkTurns(loaded);
    expect(got.violations).toBeGreaterThanOrEqual(2);
    expect(got.examples[0]).toMatch(/^kural 7 \(no no_left_turn\)/);
  });

  it('counts a rule about a turn that does not exist as moot and a missing road as moot', async () => {
    const ctx = await routeFixture({ '34': crossing([]) });
    const loaded = await loadPlate(ctx, '34');
    loaded.rows.rules.push({ id: 9, kind: 'no', restriction: 'no_left_turn', from: 99, to: 3, via: [{ n: 10 }] }, { id: 10, kind: 'no', restriction: 'no_u_turn', from: 1, to: 2, via: [{ w: 5 }] });
    expect(checkTurns(loaded)).toMatchObject({ rules: 2, tested: 0, moot: 2, violations: 0 });
  });

  it('treats a u-turn rule on a one-way road as moot, not as a ban on driving straight on', async () => {
    const straight = rows([way(1, [[1, X0, Y0], [2, X0 + D, Y0], [3, X0 + 2 * D, Y0]], { oneway: 'f' })], [{ id: 5, kind: 'no', restriction: 'no_u_turn', from: 1, to: 1, via: [{ n: 2 }] }]);
    const ctx = await routeFixture({ '34': straight });
    expect(checkTurns(await loadPlate(ctx, '34'))).toMatchObject({ rules: 1, tested: 0, moot: 1, violations: 0 });
  });

  it('counts a u-turn along the same road piece apart, since a route cannot be forced through it', async () => {
    const uturn = rows([way(1, [[1, X0, Y0], [2, X0 + D, Y0]]), way(2, [[2, X0 + D, Y0], [3, X0 + 2 * D, Y0]])], [{ id: 6, kind: 'no', restriction: 'no_u_turn', from: 1, to: 1, via: [{ n: 2 }] }]);
    const ctx = await routeFixture({ '34': uturn });
    expect(checkTurns(await loadPlate(ctx, '34'))).toMatchObject({ rules: 1, tested: 0, sameEdge: 1, reversed: 1, moot: 0, violations: 0 });
  });

  it('notices a u-turn rule that the expanded graph does not enforce', async () => {
    const uturn = rows([way(1, [[1, X0, Y0], [2, X0 + D, Y0]]), way(2, [[2, X0 + D, Y0], [3, X0 + 2 * D, Y0]])], []);
    const ctx = await routeFixture({ '34': uturn });
    const loaded = await loadPlate(ctx, '34');
    loaded.rows.rules.push({ id: 6, kind: 'no', restriction: 'no_u_turn', from: 1, to: 1, via: [{ n: 2 }] });
    const got = checkTurns(loaded);
    expect(got).toMatchObject({ sameEdge: 1, reversed: 1, violations: 0 });
    const lax = checkTurns(loaded, Infinity, (graph) => applyRestrictions(graph, []));
    expect(lax.violations).toBe(1);
    expect(lax.examples[0]).toMatch(/^kural 6 \(no no_u_turn\): U dönüşü yayı kaldı$/);
  });

  it('summarises a province as a table and fails when nothing could be tested', async () => {
    const ctx = await routeFixture({ '34': crossing([ban]) });
    const got = await measureTurns(ctx);
    expect(got.pass).toBe(true);
    expect(got.report).toContain('| 34 | 1 |');
    const none = await measureTurns(await routeFixture({ '34': crossing([]) }));
    expect(none.pass).toBe(false);
  });
});

describe('heavyAvoidance', () => {
  const road = (streetMeters: number): ReturnType<typeof rows> =>
    rows([
      way(1, [[1, X, Y], [2, X + lon(1000), Y]], { cls: 'motorway' }),
      way(2, [[3, X, Y + deg(streetMeters)], [4, X + lon(1000), Y + deg(streetMeters)]]),
      way(3, [[1, X, Y], [3, X, Y + deg(streetMeters)]]),
    ]);

  it('finds the sites beside a motorway going to the street when one is within 200 metres', async () => {
    const ctx = await routeFixture({ '34': road(150) });
    const got = heavyAvoidance(await loadPlate(ctx, '34'), 40);
    expect(got.tried).toBe(40);
    expect(got.avoidable).toBe(0);
    expect(got.kept).toBe(0);
  });

  it('lets a site keep the motorway when nothing else is near, without calling that a mistake', async () => {
    const ctx = await routeFixture({ '34': road(400) });
    const got = heavyAvoidance(await loadPlate(ctx, '34'), 40);
    expect(got.kept).toBeGreaterThan(0);
    expect(got.avoidable).toBe(0);
  });
});
