import { blob, makeWorld } from '../helpers/pack-world';
import { requested, setup, stored } from '../helpers/pack-setup';

describe('updates', () => {
  it('marks an installed region update-available without touching its files', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    const oldAddress = manager.installedFile('35', 'address');
    world.setPart('35', 'address', blob(21_000, 40));
    world.publish();
    const result = await manager.checkUpdates();
    expect(result).toMatchObject({ ok: true, updates: ['35'], diff: { changed: [{ id: '35', kinds: ['address'] }] } });
    expect(manager.status('35')).toMatchObject({ state: 'update-available', installedParts: ['address', 'tiles'] });
    expect(manager.status('35').availableVersion).not.toBe(manager.status('35').installedVersion);
    expect(manager.installedFile('35', 'address')).toBe(oldAddress);
    expect(world.env.fs.files.has(oldAddress as string)).toBe(true);
  });

  it('reports no update and keeps the state when the manifest has not changed', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    expect(await manager.checkUpdates()).toMatchObject({ ok: true, updates: [] });
    expect(manager.status('06').state).toBe('installed');
    expect(world.env.fs.files.size).toBeGreaterThan(0);
  });

  it('downloads only what changed, switches over, and deletes the old file after telling the hooks', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    const oldAddress = manager.installedFile('35', 'address') as string;
    world.setPart('35', 'address', blob(21_000, 41));
    world.publish();
    await manager.checkUpdates();
    const closed: string[][] = [];
    manager.beforeDelete(async (paths) => {
      closed.push(paths);
      expect(world.env.fs.files.has(oldAddress)).toBe(true);
    });
    world.env.server.log.length = 0;
    await manager.download('35');
    expect(requested(world).filter((p) => !p.startsWith('manifest'))).toEqual([world.pathOf('35', 'address')]);
    expect(manager.status('35')).toMatchObject({ state: 'installed', availableVersion: null });
    expect(manager.installedFile('35', 'address')).toBe(`files/${world.pathOf('35', 'address')}`);
    expect(world.env.fs.files.has(oldAddress)).toBe(false);
    expect(closed).toEqual([[oldAddress]]);
    expect(stored(world, manager.installedFile('35', 'address') as string)).toEqual(Array.from(world.regions[1]?.parts.address ?? []));
  });

  it('keeps the old files in use when the update fails', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    const oldAddress = manager.installedFile('35', 'address') as string;
    const oldBytes = stored(world, oldAddress);
    world.setPart('35', 'address', blob(21_000, 42));
    world.publish();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'status', status: 404 }, match: (url) => url.includes(world.pathOf('35', 'address')) });
    await expect(manager.download('35')).rejects.toMatchObject({ code: 'http-404' });
    expect(manager.status('35')).toMatchObject({ state: 'error', installedParts: ['address', 'tiles'] });
    expect(manager.installedFile('35', 'address')).toBe(oldAddress);
    expect(stored(world, oldAddress)).toEqual(oldBytes);
  });

  it('goes back to installed when the manifest returns to the installed content', async () => {
    const { world, manager } = await setup();
    const original = world.regions[1]?.parts.address as Uint8Array;
    await manager.download('35');
    world.setPart('35', 'address', blob(21_000, 43));
    world.publish();
    await manager.checkUpdates();
    expect(manager.status('35').state).toBe('update-available');
    world.setPart('35', 'address', original);
    world.publish();
    await manager.checkUpdates();
    expect(manager.status('35').state).toBe('installed');
  });

  it('replaces the shared base pack when the base changes and clears the old files', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    const oldBase = [...world.env.fs.files.keys()].filter((p) => p.startsWith('files/base-'));
    world.base['overview.pmtiles'] = blob(9_500, 77);
    world.publish();
    const result = await manager.checkUpdates();
    expect(result).toMatchObject({ ok: true, diff: { baseChanged: true } });
    await manager.download('06', { parts: ['address', 'tiles'] });
    const nowBase = [...world.env.fs.files.keys()].filter((p) => p.startsWith('files/base-'));
    expect(nowBase.length).toBe(oldBase.length);
    expect(stored(world, 'files/base-20261022/overview.pmtiles')).toEqual(Array.from(world.base['overview.pmtiles'] as Uint8Array));
  });
});

describe('pause, resume and remove', () => {
  it('pauses a running download, keeps the partial data and finishes after resume', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    let paused: Promise<void> | null = null;
    const first = manager.download('35', {
      onProgress: (done) => {
        if (done >= 30_000 && !paused) paused = manager.pause('35');
      },
    });
    await expect(first).rejects.toMatchObject({ code: 'cancelled' });
    await paused;
    expect(manager.status('35')).toMatchObject({ state: 'paused', installedParts: [] });
    expect([...world.env.fs.files.keys()].some((p) => p.startsWith('.part/') || p.startsWith('files/'))).toBe(true);
    await manager.resume('35');
    expect(manager.status('35')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'] });
    expect(stored(world, manager.installedFile('35', 'tiles') as string)).toEqual(Array.from(world.regions[1]?.parts.tiles ?? []));
  });

  it('pauses a queued download without starting it', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const first = manager.download('34');
    const second = manager.download('35');
    await manager.pause('35');
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    expect(manager.status('35').state).toBe('paused');
    await first;
    expect(requested(world).some((p) => p.startsWith('35/'))).toBe(false);
    await manager.resume('35');
    expect(manager.status('35').state).toBe('installed');
  });

  it('treats download on a paused region as resume', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    const first = manager.download('06', { onProgress: (d) => d > 100 && void manager.pause('06') });
    await expect(first).rejects.toBeDefined();
    await manager.download('06');
    expect(manager.status('06').state).toBe('installed');
  });

  it('ignores pause and resume where they make no sense', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    await manager.pause('06');
    await manager.resume('06');
    expect(manager.status('06').state).toBe('none');
    await manager.download('06');
    await manager.pause('06');
    await manager.resume('06');
    expect(manager.status('06').state).toBe('installed');
  });

  it('removes a region, frees its space and drops the base pack with the last map', async () => {
    const { world, manager } = await setup();
    await manager.download('34');
    await manager.download('35');
    const used = world.env.fs.used();
    await manager.remove('34');
    expect(manager.status('34')).toMatchObject({ state: 'none', installedParts: [] });
    expect(world.env.fs.used()).toBeLessThan(used - 79_000);
    expect(manager.baseDir()).not.toBeNull();
    await manager.remove('35');
    expect(manager.baseDir()).toBeNull();
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('files/') || p.startsWith('.part/'))).toEqual([]);
  });

  it('removes only the named part', async () => {
    const { manager } = await setup();
    await manager.download('34', { parts: ['address', 'tiles', 'buildings'] });
    await manager.remove('34', ['buildings']);
    expect(manager.status('34')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'] });
    await manager.remove('34', ['tiles']);
    expect(manager.status('34').installedParts).toEqual(['address']);
    expect(manager.baseDir()).toBeNull();
  });

  it('stops a running download on remove and leaves no file behind', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    let removal: Promise<void> | null = null;
    const running = manager.download('35', {
      onProgress: (d) => {
        if (d > 25_000 && !removal) removal = manager.remove('35');
      },
    });
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    await removal;
    expect(manager.status('35').state).toBe('none');
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('files/') || p.startsWith('.part/'))).toEqual([]);
  });

  it('drops a queued download on remove', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const first = manager.download('34');
    const second = manager.download('35');
    await manager.remove('35');
    await expect(second).rejects.toMatchObject({ code: 'cancelled' });
    await first;
    expect(manager.status('35').state).toBe('none');
    expect(requested(world).some((p) => p.startsWith('35/'))).toBe(false);
  });

  it('ends cleanly when download and remove race on one region', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const download = manager.download('06').catch(() => undefined);
    await manager.remove('06');
    await download;
    await manager.idle();
    expect(manager.status('06').state).toBe('none');
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('files/'))).toEqual([]);
  });
});

describe('Wi-Fi only', () => {
  it('waits on a mobile connection and goes on when Wi-Fi returns', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'wifi' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    const running = manager.download('06');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.status('06')).toMatchObject({ state: 'queued', waitingWifi: true });
    expect(requested(world).some((p) => p.startsWith('06/'))).toBe(false);
    world.env.connectivity.set('wifi');
    await running;
    expect(manager.status('06')).toMatchObject({ state: 'installed', waitingWifi: false });
  });

  it('downloads on mobile data when the caller allows it', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'wifi' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    await manager.download('06', { allowCellular: true });
    expect(manager.status('06').state).toBe('installed');
  });

  it('does not wait on mobile data when the setting is always', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'always' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    await manager.download('06');
    expect(manager.status('06').state).toBe('installed');
  });

  it('can be paused while it waits for Wi-Fi', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'wifi' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    const running = manager.download('06');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await manager.pause('06');
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    expect(manager.status('06')).toMatchObject({ state: 'paused', waitingWifi: false });
  });
});

describe('Wi-Fi only for one download', () => {
  it('waits on mobile data for a single download even when the setting is always, and goes on with Wi-Fi', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'always' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    const running = manager.download('06', { wifiOnly: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(manager.status('06')).toMatchObject({ state: 'queued', waitingWifi: true });
    expect(requested(world).some((p) => p.startsWith('06/'))).toBe(false);
    world.env.connectivity.set('wifi');
    await running;
    expect(manager.status('06')).toMatchObject({ state: 'installed', waitingWifi: false });
  });

  it('lets a later allowCellular download win over the wait', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'always' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    await manager.download('06', { wifiOnly: true, allowCellular: true });
    expect(manager.status('06').state).toBe('installed');
  });

  it('downloads on Wi-Fi at once', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'always' });
    await manager.checkUpdates();
    world.env.connectivity.set('wifi');
    await manager.download('06', { wifiOnly: true });
    expect(manager.status('06').state).toBe('installed');
  });
});

describe('download size and connection', () => {
  it('adds the missing base pack to the first province and nothing to the next', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const own = world.regions.find((r) => r.id === '06')!;
    const parts = own.parts.address!.length + own.parts.tiles!.length;
    const base = Object.values(world.base).reduce((sum, bytes) => sum + bytes.length, 0);
    expect(manager.downloadBytes('06')).toBe(parts + base);
    expect(manager.downloadBytes('06', ['address'])).toBe(own.parts.address!.length);
    await manager.download('06');
    expect(manager.downloadBytes('06')).toBe(0);
    const next = world.regions.find((r) => r.id === '35')!;
    expect(manager.downloadBytes('35')).toBe(next.parts.address!.length + next.parts.tiles!.length);
    expect(manager.downloadBytes('99')).toBe(0);
  });

  it('only counts parts that changed on an update', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    world.setPart('35', 'address', blob(21_000, 42));
    world.publish();
    await manager.checkUpdates();
    expect(manager.downloadBytes('35', ['address', 'tiles'])).toBe(21_000);
  });

  it('tells the connection and passes its changes on', async () => {
    const { world, manager } = await setup();
    world.env.connectivity.set('cellular');
    expect(await manager.connection()).toBe('cellular');
    const seen: string[] = [];
    const off = manager.onConnection((kind) => seen.push(kind));
    world.env.connectivity.set('wifi');
    world.env.connectivity.set('none');
    off();
    world.env.connectivity.set('cellular');
    expect(seen).toEqual(['wifi', 'none']);
  });
});

describe('dismissed suggestions', () => {
  it('remembers a dismissed region across restarts', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.dismiss('35');
    await first.manager.dismiss('35');
    await first.manager.dismiss('06');
    expect(first.manager.dismissed()).toEqual(['06', '35']);
    const second = await setup(world);
    expect(second.manager.dismissed()).toEqual(['06', '35']);
  });
});
