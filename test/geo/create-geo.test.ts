import { createGeo, SDK_VERSION, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore } from '../../src/core/learn/store';
import { turkeyBorders } from '../address/helpers/search-fixture';
import { nodeOpener } from '../helpers/node-opener';
import { packWorld } from '../helpers/real-world';
import type { World } from '../helpers/pack-world';

const hint = { hints: { city: 'İstanbul' } };

function envOf(world: World, extra: Partial<GeoEnv> = {}): GeoEnv {
  return { fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity, opener: nodeOpener(world), learnStore: memoryStore(), borders: turkeyBorders(), ...extra };
}

describe('createGeo', () => {
  it('goes from an empty phone to an answer, to a learned door, and keeps it across a restart', async () => {
    const { world } = await packWorld();
    const learnStore = memoryStore();
    const first = await createGeo(world.config, envOf(world, { learnStore }));
    expect(await first.search.resolve('bahariye caddesi 14', hint)).toEqual({ status: 'region_missing', regions: ['34'] });
    await first.regions.checkUpdates();
    await first.regions.download('34', { parts: ['address'] });
    const found = await first.search.resolve('bahariye caddesi 14', hint);
    expect(found.status).toBe('resolved');
    if (found.status !== 'resolved') return;
    expect(found.best.approximate).toBe(false);
    const target: [number, number] = [found.best.coordinate[0] + 0.0003, found.best.coordinate[1] + 0.0002];
    expect(await first.learn.confirm({ place: found.best, point: target, source: 'pin' })).toMatchObject({ ok: true, trusted: true });
    await first.dispose();

    const second = await createGeo(world.config, envOf(world, { learnStore }));
    const again = await second.search.resolve('bahariye caddesi 14', hint);
    expect(again).toMatchObject({ status: 'resolved', best: { source: 'learned' } });
    if (again.status === 'resolved') expect(again.best.coordinate).toEqual(target);
    await second.dispose();
  });

  it('downloads the address part of every region that is not installed yet', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    const seen: number[] = [];
    const first = await geo.regions.downloadCountry({ onProgress: (done) => seen.push(done) });
    expect(first.failed).toEqual([]);
    expect(first.installed).toEqual(geo.regions.list().map((r) => r.id).filter((id) => geo.regions.installed().includes(id)));
    expect(geo.regions.installed()).toContain('34');
    expect(seen.length === 0 || seen.every((n, i) => i === 0 || n >= (seen[i - 1] as number))).toBe(true);
    expect(await geo.regions.downloadCountry()).toEqual({ installed: [], failed: [] });
    await geo.dispose();
  });

  it('closes the learning store when it is disposed', async () => {
    const { world } = await packWorld();
    let closed = 0;
    const learnStore = { ...memoryStore(), async close() { closed += 1; } };
    const geo = await createGeo(world.config, envOf(world, { learnStore }));
    await geo.dispose();
    expect(closed).toBe(1);
  });

  it('answers in the configured language unless the call names one', async () => {
    const { world } = await packWorld();
    const geo = await createGeo({ ...world.config, language: 'en' }, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const english = await geo.search.resolve('bahariye caddesi 14', hint);
    const turkish = await geo.search.resolve('bahariye caddesi 14', { ...hint, language: 'tr' });
    expect(english.status === 'resolved' && turkish.status === 'resolved').toBe(true);
    if (english.status === 'resolved' && turkish.status === 'resolved') {
      expect(english.best.label).not.toBe(turkish.best.label);
      expect(english.best.label).toMatch(/^14 Bahariye/);
    }
    await geo.dispose();
  });

  it('reads the new pack after an update', async () => {
    const { world, v2 } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    expect((await geo.search.resolve('yeni sokak 9', hint)).status).not.toBe('resolved');
    world.setPart('34', 'address', v2);
    world.publish();
    await geo.regions.checkUpdates();
    expect(geo.regions.status('34').state).toBe('update-available');
    await geo.regions.download('34');
    expect(await geo.search.resolve('yeni sokak 9', hint)).toMatchObject({ status: 'resolved', best: { components: { street: 'Yeni Sokak' } } });
    await geo.dispose();
  });

  it('finds the province of a point and decides what to offer', async () => {
    const { world } = await packWorld();
    const geo = await createGeo({ ...world.config, autoDownload: 'ask' }, envOf(world));
    expect(geo.regions.detect([28.9, 41.0])).toEqual({ region: '34', nearBorder: [] });
    expect(geo.regions.suggest([28.9, 41.0])).toEqual({ action: 'suggest', regions: ['34'], neighbours: [] });
    await geo.regions.dismiss('34');
    expect(geo.regions.suggest([28.9, 41.0])).toEqual({ action: 'none', regions: [], neighbours: [] });
    expect(geo.regions.dismissed()).toEqual(['34']);
    await geo.dispose();
  });

  it('asks before a province over the mobile data limit and leaves small ones and Wi-Fi alone', async () => {
    const { world } = await packWorld();
    const MB = 1024 * 1024;
    const geo = await createGeo({ ...world.config, autoDownload: 'always', cellularAskMb: 0.0001 }, envOf(world));
    await geo.regions.checkUpdates();
    const bytes = geo.regions.downloadBytes('34');
    expect(bytes).toBeGreaterThan(0.0001 * MB);
    expect(geo.regions.suggest([28.9, 41.0], { connection: 'cellular' })).toEqual({ action: 'consent', regions: ['34'], neighbours: [], bytes });
    expect(geo.regions.suggest([28.9, 41.0], { connection: 'wifi' }).action).toBe('download');
    expect(geo.regions.suggest([28.9, 41.0]).action).toBe('download');
    await geo.dispose();
    const roomy = await createGeo({ ...world.config, autoDownload: 'always' }, envOf(world));
    await roomy.regions.checkUpdates();
    expect(roomy.regions.suggest([28.9, 41.0], { connection: 'cellular' }).action).toBe('download');
    await roomy.dispose();
    const off = await createGeo({ ...world.config, autoDownload: 'always', cellularAskMb: Number.POSITIVE_INFINITY }, envOf(world));
    await off.regions.checkUpdates();
    expect(off.regions.suggest([28.9, 41.0], { connection: 'cellular' }).action).toBe('download');
    await off.dispose();
  });

  it('stops offering a province once its download is queued, and tells the connection', async () => {
    const { world } = await packWorld();
    const geo = await createGeo({ ...world.config, autoDownload: 'always', cellularAskMb: 0 }, envOf(world));
    await geo.regions.checkUpdates();
    world.env.connectivity.set('cellular');
    expect(await geo.regions.connection()).toBe('cellular');
    expect(geo.regions.suggest([28.9, 41.0], { connection: 'cellular' }).action).toBe('consent');
    const queued = geo.regions.download('34', { wifiOnly: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(geo.regions.suggest([28.9, 41.0], { connection: 'cellular' }).action).toBe('none');
    const seen: string[] = [];
    const off = geo.regions.onConnection((kind) => seen.push(kind));
    world.env.connectivity.set('wifi');
    await queued;
    off();
    expect(seen).toEqual(['wifi']);
    expect(geo.regions.suggest([28.9, 41.0], { connection: 'wifi' }).action).toBe('none');
    await geo.dispose();
  });

  it('does not store confirmations when learning is switched off', async () => {
    const { world } = await packWorld();
    const learnStore = memoryStore();
    const geo = await createGeo({ ...world.config, learning: { enabled: false } }, envOf(world, { learnStore }));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const found = await geo.search.resolve('bahariye caddesi 14', hint);
    if (found.status !== 'resolved') throw new Error('expected a hit');
    expect(await geo.learn.confirm({ place: found.best, point: [28.6, 40.7], source: 'pin' })).toEqual({ ok: false, reason: 'disabled' });
    expect(await learnStore.readAll()).toEqual([]);
    expect(geo.learn.export()).toEqual([]);
    expect(await geo.learn.import(['{}'])).toEqual({ added: 0, merged: 0, skipped: 0 });
    await geo.dispose();
  });

  it('exports, imports and clears learned doors', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const found = await geo.search.resolve('bahariye caddesi 14', hint);
    if (found.status !== 'resolved') throw new Error('expected a hit');
    await geo.learn.confirm({ place: found.best, point: [28.6004, 40.7002], source: 'pin' });
    const lines = geo.learn.export();
    expect(lines).toHaveLength(1);
    const other = await createGeo(world.config, envOf(world));
    expect(await other.learn.import(lines)).toMatchObject({ added: 1 });
    await geo.learn.clear();
    expect(geo.learn.export()).toEqual([]);
    expect(other.learn.export()).toHaveLength(1);
    await geo.dispose();
    await other.dispose();
  });

  it('uses the embedded province borders when none are given', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, { ...envOf(world), borders: undefined });
    expect(geo.regions.detect([32.8597, 39.9334]).region).toBe('06');
    await geo.dispose();
  });

  it('reports the SDK version it checks manifests against', async () => {
    expect(SDK_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const { world } = await packWorld();
    world.publish({ minSdk: '99.0.0' });
    const geo = await createGeo({ manifestUrl: world.manifestUrl, publicKeys: world.config.publicKeys }, envOf(world));
    expect(await geo.regions.checkUpdates()).toEqual({ ok: false, code: 'sdk-too-old' });
    await geo.dispose();
  });
});

describe('createGeo regions surface', () => {
  it('passes every region call through to the manager', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    expect(geo.regions.list()).toEqual([]);
    expect(geo.regions.installed()).toEqual([]);
    let heard = 0;
    const off = geo.regions.subscribe(() => void (heard += 1));
    await geo.regions.checkUpdates();
    expect(geo.regions.list().map((r) => r.id)).toEqual(['06', '34']);
    expect(geo.regions.missingBaseBytes()).toBe(9_300);
    await geo.regions.download('34', { parts: ['address', 'tiles', 'buildings'] });
    expect(geo.regions.installed()).toEqual(['34']);
    expect(geo.regions.status('34')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles', 'buildings'] });
    expect(geo.regions.installedFile('34', 'address')).toMatch(/^files\/34\/address-/);
    expect(geo.regions.baseDir()).toBe('files/base-20261022');
    expect(geo.regions.missingBaseBytes()).toBe(0);
    expect(heard).toBeGreaterThan(0);
    off();
    await geo.regions.remove('34', ['buildings']);
    expect(geo.regions.status('34').installedParts).toEqual(['address', 'tiles']);
    await geo.regions.remove('34');
    expect(geo.regions.installed()).toEqual([]);
    await geo.dispose();
  });

  it('pauses and resumes through the surface', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    const running = geo.regions.download('06', { onProgress: (done) => done > 2_000 && void geo.regions.pause('06') });
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(geo.regions.status('06').state).toBe('paused');
    await geo.regions.resume('06');
    expect(geo.regions.status('06').state).toBe('installed');
    await geo.dispose();
  });

  it('counts learned doors in the stats and clears them', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    expect(geo.learn.stats()).toEqual({ keys: 0, confirmations: 0, damaged: 0, newer: 0 });
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const found = await geo.search.resolve('bahariye caddesi 14', hint);
    if (found.status !== 'resolved') throw new Error('expected a hit');
    await geo.learn.confirm({ place: found.best, point: [28.6004, 40.7002], source: 'pin' });
    expect(geo.learn.stats()).toMatchObject({ keys: 1, confirmations: 1 });
    await geo.learn.clear();
    expect(geo.learn.stats().keys).toBe(0);
    await geo.dispose();
  });

  it('reports empty stats and does nothing on clear when learning is off', async () => {
    const { world } = await packWorld();
    const geo = await createGeo({ ...world.config, learning: { enabled: false } }, envOf(world));
    expect(geo.learn.stats()).toEqual({ keys: 0, confirmations: 0, damaged: 0, newer: 0 });
    await geo.learn.clear();
    await geo.dispose();
  });
});

describe('createGeo map helpers', () => {
  it('gives neighbourhood labels and the data coverage of the installed provinces', async () => {
    const { world } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    expect(await geo.search.hoods()).toEqual([]);
    expect(await geo.search.coverage([28.7, 41.0])).toBeNull();
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const hoods = await geo.search.hoods();
    expect(hoods.map((h) => h.name)).toEqual(expect.arrayContaining(['Moda', 'Fener']));
    expect(await geo.search.coverage([28.7, 41.0])).toMatchObject({ region: '34', district: 'Kadıköy', level: 'sparse' });
    await geo.dispose();
  });
});
