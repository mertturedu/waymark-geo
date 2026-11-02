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
});
