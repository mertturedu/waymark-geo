import { createPackManager, type PackManager } from '../../src/core/packs/manager';
import { makeWorld, type World } from '../helpers/pack-world';

type Opts = { autoDownload?: 'ask' | 'wifi' | 'always' | 'never' };

async function setup(world: World = makeWorld(), opts: Opts = {}): Promise<{ world: World; manager: PackManager }> {
  const manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, { ...world.config, ...opts });
  return { world, manager };
}

const stored = (world: World, path: string): number[] => Array.from(world.env.fs.files.get(path) ?? []);
const served = (world: World, url: string): number[] => stored(world, url);

const requested = (world: World): string[] => world.env.server.log.map((r) => r.url.replace(`${world.baseUrl}/`, ''));

describe('first run', () => {
  it('fetches and keeps the signed manifest, then lists the regions', async () => {
    const { world, manager } = await setup();
    expect(manager.manifest()).toBeNull();
    expect(manager.regions()).toEqual([]);
    const result = await manager.checkUpdates();
    expect(result).toMatchObject({ ok: true, updates: [] });
    expect(manager.regions().map((r) => r.id)).toEqual(['06', '34', '35']);
    expect(world.env.fs.files.has('manifest-v1.json')).toBe(true);
    expect(world.env.fs.files.has('manifest-v1.json.sig')).toBe(true);
    expect(requested(world)).toEqual(['manifest-v2.json', 'manifest-v1.json', 'manifest-v1.json.sig']);
  });

  it('shows every region as none before anything is installed', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    for (const id of ['06', '34', '35']) expect(manager.status(id)).toMatchObject({ id, state: 'none', progress: null, error: null, waitingWifi: false, installedVersion: null, installedParts: [] });
    expect(manager.status('77').state).toBe('none');
  });
});

describe('download', () => {
  it('installs the address and map parts with the shared base pack and nothing else', async () => {
    const { world, manager } = await setup();
    await manager.download('34');
    expect(manager.status('34')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'], progress: null, error: null });
    expect(stored(world, `files/${world.pathOf('34', 'address')}`)).toEqual(Array.from(world.regions[0]?.parts.address ?? []));
    expect(stored(world, `files/${world.pathOf('34', 'tiles')}`)).toEqual(Array.from(world.regions[0]?.parts.tiles ?? []));
    expect(world.env.fs.files.has('files/base-20261022/overview.pmtiles')).toBe(true);
    expect(world.env.fs.files.has('files/base-20261022/sprites/v4/light.json')).toBe(true);
    expect(requested(world).some((p) => p.includes('buildings'))).toBe(false);
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('.part/'))).toEqual([]);
    expect(manager.installedFile('34', 'address')).toBe(`files/${world.pathOf('34', 'address')}`);
    expect(manager.installedFile('34', 'buildings')).toBeNull();
  });

  it('downloads only the address file when only the address part is asked for', async () => {
    const { world, manager } = await setup();
    await manager.download('35', { parts: ['address'] });
    expect(manager.status('35').installedParts).toEqual(['address']);
    expect(requested(world).filter((p) => !p.startsWith('manifest'))).toEqual([world.pathOf('35', 'address')]);
    expect(world.env.fs.files.has('files/base-20261022/overview.pmtiles')).toBe(false);
  });

  it('adds the optional buildings part on request', async () => {
    const { manager } = await setup();
    await manager.download('34');
    await manager.download('34', { parts: ['address', 'tiles', 'buildings'] });
    expect(manager.status('34').installedParts).toEqual(['address', 'tiles', 'buildings']);
  });

  it('walks through queued, downloading, verifying and installed', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    const seen: string[] = [];
    manager.subscribe(() => {
      const state = manager.status('34').state;
      if (seen.at(-1) !== state) seen.push(state);
    });
    await manager.download('34');
    expect(seen).toEqual(['queued', 'downloading', 'verifying', 'installed']);
  });

  it('reports progress up to the total size and clears it at the end', async () => {
    const { world, manager } = await setup();
    const marks: [number, number][] = [];
    await manager.download('35', { onProgress: (done, total) => marks.push([done, total]) });
    const total = 20_000 + 40_000 + 9_000 + 300;
    expect(marks.at(-1)).toEqual([total, total]);
    expect(marks.every(([d], i) => i === 0 || d >= (marks[i - 1] as [number, number])[0])).toBe(true);
    expect(manager.status('35').progress).toBeNull();
    expect(world.env.fs.files.size).toBeGreaterThan(0);
  });

  it('runs one download at a time and queues the next region', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    let busy = 0;
    let worst = 0;
    manager.subscribe(() => {
      busy = ['34', '35', '06'].filter((id) => ['downloading', 'verifying'].includes(manager.status(id).state)).length;
      worst = Math.max(worst, busy);
    });
    const first = manager.download('34');
    const second = manager.download('35');
    expect(manager.status('35').state).toBe('queued');
    await Promise.all([first, second]);
    expect(worst).toBe(1);
    expect(manager.status('34').state).toBe('installed');
    expect(manager.status('35').state).toBe('installed');
  });

  it('joins a second request for the same region to the running one', async () => {
    const { world, manager } = await setup();
    await Promise.all([manager.download('06'), manager.download('06')]);
    expect(requested(world).filter((p) => p.startsWith('06/address'))).toHaveLength(1);
  });

  it('does not download again when everything asked for is already installed', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    const before = world.env.server.log.length;
    await manager.download('06');
    expect(world.env.server.log.length).toBe(before);
  });

  it('refuses unknown regions and parts the manifest does not have', async () => {
    const { manager } = await setup();
    await expect(manager.download('77')).rejects.toMatchObject({ code: 'malformed' });
    await expect(manager.download('35', { parts: ['buildings'] })).rejects.toMatchObject({ code: 'malformed' });
    expect(manager.status('35').state).toBe('none');
  });

  it('fetches the manifest by itself when none is stored yet', async () => {
    const { world, manager } = await setup();
    await manager.download('06', { parts: ['address'] });
    expect(requested(world).slice(0, 2)).toEqual(['manifest-v2.json', 'manifest-v1.json']);
  });

  it('fails with network when the manifest cannot be fetched and nothing is stored', async () => {
    const { world, manager } = await setup();
    world.env.server.inject({ effect: { kind: 'offline' } });
    await expect(manager.download('06')).rejects.toMatchObject({ code: 'network' });
    expect(manager.status('06').state).toBe('none');
  });
});

describe('failures leave nothing half installed', () => {
  const finalFiles = (world: World): string[] => [...world.env.fs.files.keys()].filter((p) => p.startsWith('files/'));

  it.each([
    ['at the start', 0],
    ['in the middle', 25_000],
    ['at the end', 49_999],
  ])('keeps going when the connection drops %s of the map file', async (_name, at) => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'cut', afterBytes: at }, times: 1, match: (url) => url.includes('/tiles-') });
    await manager.download('34');
    expect(manager.status('34').state).toBe('installed');
    expect(stored(world, `files/${world.pathOf('34', 'tiles')}`)).toEqual(Array.from(world.regions[0]?.parts.tiles ?? []));
  });

  it('ends in error no-space when the disk is too small, with no file left', async () => {
    const { world, manager } = await setup(makeWorld({ capacity: 70_000 }));
    await expect(manager.download('34')).rejects.toMatchObject({ code: 'no-space' });
    expect(manager.status('34')).toMatchObject({ state: 'error', error: { code: 'no-space' }, installedParts: [] });
    expect(finalFiles(world).filter((p) => !p.includes('base-'))).toEqual([]);
    expect(manager.installedFile('34', 'address')).toBeNull();
  });

  it('ends in error checksum when a file does not match the manifest', async () => {
    const world = makeWorld();
    const manager = (await setup(world)).manager;
    world.env.server.put(`${world.baseUrl}/${world.pathOf('34', 'address')}`, new Uint8Array(30_000).fill(9));
    await expect(manager.download('34')).rejects.toMatchObject({ code: 'checksum' });
    expect(manager.status('34')).toMatchObject({ state: 'error', error: { code: 'checksum' }, installedParts: [] });
    expect(finalFiles(world).some((p) => p.includes('34/'))).toBe(false);
  });

  it('ends in error http-404 when a file is missing on the server', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'status', status: 404 }, match: (url) => url.includes('/tiles-') });
    await expect(manager.download('34')).rejects.toMatchObject({ code: 'http-404' });
    expect(manager.status('34').state).toBe('error');
    expect(manager.installedFile('34', 'address')).toBeNull();
  });

  it('can be retried after an error and then reuses the partial data', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'offline' }, times: 40, match: (url) => url.includes('/tiles-') });
    await expect(manager.download('34')).rejects.toMatchObject({ code: 'network' });
    expect(manager.status('34').state).toBe('error');
    world.env.server.clear();
    await manager.download('34');
    expect(manager.status('34')).toMatchObject({ state: 'installed', error: null });
  });

  it('keeps an installed region working when an update check fails', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    const before = manager.manifest();
    world.env.server.inject({ effect: { kind: 'offline' }, times: 2 });
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'network' });
    expect(manager.manifest()).toEqual(before);
    expect(manager.status('06').state).toBe('installed');
  });

  it.each([
    ['a bad signature', (w: World) => w.publish({ tamper: true }), 'signature'],
    ['a newer manifest format', (w: World) => w.publish({ format: 3 }), 'manifest-newer'],
    ['an SDK that is too old', (w: World) => w.publish({ minSdk: '9.0.0' }), 'sdk-too-old'],
  ])('refuses %s and keeps the stored manifest and the install', async (_name, publish, code) => {
    const { world, manager } = await setup();
    await manager.download('06');
    const before = manager.manifest();
    publish(world);
    expect(await manager.checkUpdates()).toEqual({ ok: false, code });
    expect(manager.manifest()).toEqual(before);
    expect(manager.status('06').state).toBe('installed');
    expect(manager.installedFile('06', 'address')).not.toBeNull();
  });

  it('refuses a Wi-Fi login page served instead of the manifest', async () => {
    const { world, manager } = await setup();
    world.env.server.inject({ effect: { kind: 'body', bytes: new TextEncoder().encode('<html>login</html>') }, times: 2 });
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'malformed' });
    expect(manager.manifest()).toBeNull();
    expect(served(world, 'x')).toEqual([]);
  });

  it('answers http-404 and http for bad manifest responses', async () => {
    const { world, manager } = await setup();
    world.env.server.inject({ effect: { kind: 'status', status: 404 }, times: 2 });
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'http-404' });
    world.env.server.inject({ effect: { kind: 'status', status: 503 }, times: 1 });
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'http' });
  });
});
