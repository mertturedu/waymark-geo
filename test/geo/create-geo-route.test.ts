import { buildRoutePack } from '../../pipeline/build/route-pack';
import { createGeo, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore } from '../../src/core/learn/store';
import { turkeyBorders } from '../address/helpers/search-fixture';
import { deg, rows, way } from '../helpers/road-world';
import { blob, makeWorld } from '../helpers/pack-world';
import { bytesOf } from '../helpers/real-world';
import { builtPack } from '../address/helpers/search-fixture';
import { nodeOpener } from '../helpers/node-opener';

const X = 29;
const Y = 41;
const lon = (meters: number): number => deg(meters) / Math.cos((Y * Math.PI) / 180);

async function world() {
  const roads = rows([way(1, [[1, X, Y], [2, X + lon(2000), Y]]), way(2, [[2, X + lon(2000), Y], [3, X + lon(2000), Y + deg(2000)]])]);
  const route = buildRoutePack(roads, { ferries: false }).bytes;
  return makeWorld({ regions: [{ id: '34', parts: { address: bytesOf(await builtPack()), tiles: blob(5_000, 3), route } }] });
}

const envOf = (w: Awaited<ReturnType<typeof world>>): GeoEnv => ({ fs: w.env.fs, net: w.env.net, hash: w.env.hash, clock: w.env.clock, connectivity: w.env.connectivity, opener: nodeOpener(w), learnStore: memoryStore(), borders: turkeyBorders() });

describe('geo.route', () => {
  it('has no route until the road part is installed, then routes, then forgets when it is removed', async () => {
    const w = await world();
    const geo = await createGeo(w.config, envOf(w));
    await geo.regions.checkUpdates();
    const from: [number, number] = [X + lon(300), Y + deg(10)];
    const to: [number, number] = [X + lon(1900), Y + deg(1500)];
    await geo.regions.download('34', { parts: ['address'] });
    expect(await geo.route.installed()).toEqual([]);
    expect(await geo.route.route(from, to)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });

    await geo.regions.download('34', { parts: ['address', 'route'] });
    expect(await geo.route.installed()).toEqual(['34']);
    const got = await geo.route.route(from, to);
    expect(got).toMatchObject({ ok: true, region: '34' });
    const table = await geo.route.matrix([from, to]);
    expect(table.ok && table.durationS[0]?.[1]).toBeGreaterThan(0);

    await geo.regions.remove('34', ['route']);
    expect(await geo.route.installed()).toEqual([]);
    expect(await geo.route.route(from, to)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
    await geo.dispose();
  });

  it('turns a route into steps in the language asked for and passes a failure on', async () => {
    const w = await world();
    const geo = await createGeo(w.config, envOf(w));
    await geo.regions.checkUpdates();
    const from: [number, number] = [X + lon(300), Y + deg(10)];
    const to: [number, number] = [X + lon(1900), Y + deg(1500)];
    expect(await geo.route.directions(from, to)).toEqual({ ok: false, code: 'START_OUTSIDE_REGION' });
    await geo.regions.download('34', { parts: ['address', 'route'] });
    const got = await geo.route.directions(from, to, { language: 'en' });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.steps.map((step) => step.kind)).toEqual(['start', 'left', 'arrive']);
    expect(got.steps[1]!.text).toMatch(/^In [\d.]+ (m|km), Turn left$/);
    const turkish = await geo.route.directions(from, to);
    expect(turkish.ok && turkish.steps[1]!.text).toMatch(/Sola dönün/);
    await geo.dispose();
  });

  it('reports the arrival side and the unit when the destination is a place', async () => {
    const w = await world();
    const geo = await createGeo(w.config, envOf(w));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address', 'route'] });
    const from: [number, number] = [X + lon(300), Y + deg(10)];
    const door: [number, number] = [X + lon(1500), Y + deg(40)];
    const toPlace = { id: '34:a:1', label: 'x', components: { street: 'Yok Sokak' }, coordinate: door, precision: 'address' as const, approximate: false, source: 'osm' as const, confidence: 1, region: '34', unit: { block: { name: 'C Blok', building: 1, center: null }, entrance: { id: 1, ref: '2', kind: 'main', flats: null, building: 1, unit: null, point: [X + lon(1500), Y + deg(40)] as [number, number] }, floor: null, door: null, levels: null, perFloor: null, notes: [] } };
    const got = await geo.route.route(from, door, { toPlace });
    expect(got.ok && got.arrival).toMatchObject({ side: 'left', target: 'entrance', onChain: false });
    const steps = await geo.route.directions(from, door, { toPlace, language: 'en' });
    expect(steps.ok && steps.steps[steps.steps.length - 1]!.text).toBe('Destination on the left, Block C, Entrance 2');
    const plan = await geo.plan.plan({ stops: [{ id: 'a', place: toPlace }, { id: 'b', point: [X + lon(1800), Y + deg(10)] }], start: { point: from }, mode: 'keep' });
    expect(plan.ok && plan.legs[0]?.arrival?.target).toBe('entrance');
    expect(await geo.plan.plan(null as never)).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    await geo.dispose();
  });

  it('lists what is near a point from the installed address pack', async () => {
    const w = await world();
    const geo = await createGeo({ ...w.config, language: 'en' }, envOf(w));
    await geo.regions.checkUpdates();
    expect(await geo.search.nearby({ point: [28.645, 40.745], group: 'pharmacy' })).toEqual([]);
    await geo.regions.download('34', { parts: ['address'] });
    const hits = await geo.search.nearby({ point: [28.645, 40.745], group: 'pharmacy', radiusM: 2000 });
    expect(hits.map((hit) => hit.place.components.poiName)).toEqual(['Merkez Eczanesi']);
    expect(hits[0]!.distanceM).toBeLessThan(5);
    await geo.dispose();
  });
});
