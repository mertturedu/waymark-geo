import { createGeo, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore } from '../../src/core/learn/store';
import { turkeyBorders } from '../address/helpers/search-fixture';
import { nodeOpener } from '../helpers/node-opener';
import { packWorld } from '../helpers/real-world';
import { blob, type World } from '../helpers/pack-world';

const envOf = (world: World): GeoEnv => ({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity, opener: nodeOpener(world), learnStore: memoryStore(), borders: turkeyBorders() });

function allowed(world: World): Set<string> {
  const manifestPaths = world.regions.flatMap((r) => Object.keys(r.parts).map((kind) => `${world.baseUrl}/${world.pathOf(r.id, kind as 'address')}`));
  const base = Object.keys(world.base).map((rel) => `${world.baseUrl}/base-20261022/${rel}`);
  return new Set([world.manifestUrl, `${world.manifestUrl}.sig`, ...manifestPaths, ...base]);
}

describe('network use (K5.6)', () => {
  it('only asks the manifest address and the files the manifest lists, through install, update and removal', async () => {
    const { world, v2 } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address', 'tiles', 'buildings'] });
    await geo.regions.download('06');
    const before = allowed(world);
    world.setPart('34', 'address', v2);
    world.publish();
    await geo.regions.checkUpdates();
    await geo.regions.download('34');
    await geo.search.resolve('bahariye caddesi 14', { hints: { city: 'İstanbul' } });
    await geo.regions.remove('06');
    await geo.dispose();
    const ok = new Set([...before, ...allowed(world)]);
    const seen = world.env.server.log.map((r) => r.url);
    expect(seen.length).toBeGreaterThan(5);
    for (const url of seen) expect(ok.has(url)).toBe(true);
  });

  it('asks nothing at all while searching and learning', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const before = world.env.server.log.length;
    const found = await geo.search.resolve('bahariye caddesi 14', { hints: { city: 'İstanbul' } });
    await geo.search.autocomplete('bahar', { hints: { city: 'İstanbul' } });
    await geo.search.reverse([28.6, 40.7]);
    if (found.status === 'resolved') await geo.learn.confirm({ place: found.best, point: [28.6, 40.7], source: 'pin' });
    expect(world.env.server.log.length).toBe(before);
    await geo.dispose();
  });

  it.each([
    ['a web address', 'https://evil.example/x.sqlite'],
    ['a parent folder', '../outside/x.sqlite'],
    ['an absolute path', '/etc/x.sqlite'],
    ['a protocol relative address', '//evil.example/x.sqlite'],
    ['a backslash', '34\\x.sqlite'],
    ['a query', '34/x.sqlite?x=1'],
  ])('refuses a signed manifest that lists %s and fetches nothing', async (_name, path) => {
    const { world } = await packWorld();
    const good = world.publish();
    const text = JSON.stringify({ ...good, regions: good.regions.map((r) => ({ ...r, files: r.files.map((f, i) => (i === 0 ? { ...f, path } : f)) })) });
    world.env.server.put(world.manifestUrl, new TextEncoder().encode(text));
    world.env.server.put(`${world.manifestUrl}.sig`, new TextEncoder().encode(world.signWith(text)));
    const geo = await createGeo(world.config, envOf(world));
    expect(await geo.regions.checkUpdates()).toEqual({ ok: false, code: 'malformed' });
    await expect(geo.regions.download('34')).rejects.toBeDefined();
    expect(world.env.server.log.map((r) => r.url).every((u) => u === world.manifestUrl || u === `${world.manifestUrl}.sig`)).toBe(true);
    void blob;
    await geo.dispose();
  });
});
