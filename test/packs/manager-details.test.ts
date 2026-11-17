import { ed25519 } from '@noble/curves/ed25519';
import { createPackManager } from '../../src/core/packs/manager';
import type { ConnectivityPort, FsPort } from '../../src/core/packs/ports';
import { loadState, STATE_PATH } from '../../src/core/packs/state-file';
import { packError } from '../../src/core/packs/types';
import { blob, makeWorld } from '../helpers/pack-world';
import { requested, setup } from '../helpers/pack-setup';

describe('partial updates', () => {
  it('keeps the older version label and still offers the rest of the update', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    const before = manager.status('35').installedVersion;
    world.setPart('35', 'address', blob(21_000, 51));
    world.setPart('35', 'tiles', blob(41_000, 52));
    world.publish();
    await manager.checkUpdates();
    await manager.download('35', { parts: ['address'] });
    expect(manager.status('35')).toMatchObject({ state: 'update-available', installedVersion: before });
    await manager.download('35');
    expect(manager.status('35')).toMatchObject({ state: 'installed', availableVersion: null });
    expect(manager.status('35').installedVersion).not.toBe(before);
  });
});

describe('start-up checks', () => {
  it('writes the cleaned-up state back after a file went missing', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    world.env.fs.files.delete(first.manager.installedFile('34', 'tiles') as string);
    await setup(world);
    expect((await loadState(world.env.fs)).state.regions['34']?.files.tiles).toBeUndefined();
    expect((await loadState(world.env.fs)).state.regions['34']?.files.address).toBeDefined();
  });

  it('forgets the base pack when one of its files went missing and fetches it again for the next map', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    world.env.fs.files.delete('files/base-20261022/overview.pmtiles');
    const second = await setup(world);
    expect(second.manager.baseDir()).toBeNull();
    expect((await loadState(world.env.fs)).state.base).toBeNull();
    world.env.server.log.length = 0;
    await second.manager.download('35');
    expect(requested(world).filter((p) => p.startsWith('base-'))).toEqual(['base-20261022/overview.pmtiles']);
    expect(second.manager.baseDir()).toBe('files/base-20261022');
  });

  it('keeps the listed base files on restart and removes unknown ones next to them', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    await world.env.fs.append('files/base-20261022/fonts/stray.pbf', new Uint8Array(10));
    await setup(world);
    expect(world.env.fs.files.has('files/base-20261022/overview.pmtiles')).toBe(true);
    expect(world.env.fs.files.has('files/base-20261022/sprites/v4/light.json')).toBe(true);
    expect(world.env.fs.files.has('files/base-20261022/fonts/stray.pbf')).toBe(false);
  });

  it('keeps a verified file the manifest knows even if no region is recorded for it', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    await world.env.fs.append(`files/${world.pathOf('06', 'address')}`, world.regions[2]?.parts.address as Uint8Array);
    await setup(world);
    expect(world.env.fs.files.has(`files/${world.pathOf('06', 'address')}`)).toBe(true);
  });

  it('ignores a manifest without its signature file and the other way round', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    const sig = world.env.fs.files.get('manifest-v1.json.sig') as Uint8Array;
    world.env.fs.files.delete('manifest-v1.json.sig');
    expect((await setup(world)).manager.manifest()).toBeNull();
    world.env.fs.files.set('manifest-v1.json.sig', sig);
    const text = world.env.fs.files.get('manifest-v1.json') as Uint8Array;
    world.env.fs.files.delete('manifest-v1.json');
    expect((await setup(world)).manager.manifest()).toBeNull();
    world.env.fs.files.set('manifest-v1.json', text);
    expect((await setup(world)).manager.manifest()).not.toBeNull();
  });

  it('drops a pending download for a region the manifest no longer lists', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    await world.env.fs.writeAtomic(STATE_PATH, JSON.stringify({ v: 1, regions: {}, base: null, pending: { '99': { parts: ['address'] }, '06': { parts: ['address'] } }, dismissed: [] }));
    const second = await setup(world);
    expect(second.manager.status('99').state).toBe('none');
    expect(second.manager.status('06').state).toBe('paused');
    expect(Object.keys((await loadState(world.env.fs)).state.pending)).toEqual(['06']);
  });

  it('keeps a pending download while the manifest is still unknown', async () => {
    const world = makeWorld();
    await world.env.fs.writeAtomic(STATE_PATH, JSON.stringify({ v: 1, regions: {}, base: null, pending: { '06': { parts: ['address'] } }, dismissed: [] }));
    const manager = (await setup(world)).manager;
    expect(manager.status('06').state).toBe('paused');
    await manager.resume('06');
    expect(manager.status('06').state).toBe('installed');
  });
});

describe('bookkeeping', () => {
  it('records the running download in the state file and clears it afterwards', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const seen: string[][] = [];
    let probing: Promise<void> = Promise.resolve();
    await manager.download('35', {
      onProgress: (done) => {
        if (done > 10_000 && seen.length === 0) probing = loadState(world.env.fs).then((l) => void seen.push(Object.keys(l.state.pending)));
      },
    });
    await probing;
    expect(seen).toEqual([['35']]);
    expect((await loadState(world.env.fs)).state.pending).toEqual({});
  });

  it('clears the pending record when a download fails', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'status', status: 404 }, match: (url) => url.includes('/tiles-') });
    await expect(manager.download('35')).rejects.toBeDefined();
    expect((await loadState(world.env.fs)).state.pending).toEqual({});
  });

  it('keeps the pending record when a download is paused', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const running = manager.download('35', { onProgress: (d) => d > 10_000 && void manager.pause('35') });
    await expect(running).rejects.toBeDefined();
    expect((await loadState(world.env.fs)).state.pending).toEqual({ '35': { parts: ['address', 'tiles'] } });
  });

  it('resolves idle at once when nothing runs and after the queue drains otherwise', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    await manager.idle();
    let drained = false;
    const first = manager.download('34');
    const second = manager.download('06');
    const waiting = manager.idle().then(() => {
      drained = true;
    });
    await first;
    expect(drained).toBe(false);
    await second;
    await waiting;
    expect(drained).toBe(true);
  });

  it('downloads the shared base pack once for several maps', async () => {
    const { world, manager } = await setup();
    await manager.download('34');
    await manager.download('35');
    expect(requested(world).filter((p) => p.startsWith('base-'))).toHaveLength(2);
  });

  it('shows waiting for Wi-Fi to listeners while it waits', async () => {
    const { world, manager } = await setup(undefined, { autoDownload: 'wifi' });
    await manager.checkUpdates();
    world.env.connectivity.set('cellular');
    const flags: boolean[] = [];
    manager.subscribe(() => flags.push(manager.status('06').waitingWifi));
    const running = manager.download('06');
    await new Promise((resolve) => setTimeout(resolve, 20));
    world.env.connectivity.set('wifi');
    await running;
    expect(flags).toContain(true);
    expect(flags.at(-1)).toBe(false);
  });

  it('polls through the clock when the connectivity port cannot notify', async () => {
    const world = makeWorld();
    let calls = 0;
    const connectivity: ConnectivityPort = { kind: async () => (++calls > 3 ? 'wifi' : 'cellular') };
    const manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity }, { ...world.config, autoDownload: 'wifi' });
    const before = world.env.clock.now();
    await manager.download('06', { parts: ['address'] });
    expect(manager.status('06').state).toBe('installed');
    expect(world.env.clock.now() - before).toBeGreaterThanOrEqual(30_000);
  });
});

describe('listeners and hooks', () => {
  it('stops telling a listener after it unsubscribes and survives a listener that throws', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    let heard = 0;
    const off = manager.subscribe(() => void (heard += 1));
    manager.subscribe(() => {
      throw new Error('listener bug');
    });
    await manager.download('06', { parts: ['address'] });
    const count = heard;
    expect(count).toBeGreaterThan(0);
    off();
    await manager.remove('06');
    expect(heard).toBe(count);
    expect(manager.status('06').state).toBe('none');
  });

  it('still deletes files when a before-delete hook throws, and stops calling a removed hook', async () => {
    const { world, manager } = await setup();
    await manager.download('06', { parts: ['address'] });
    let calls = 0;
    const off = manager.beforeDelete(async () => {
      calls += 1;
      throw new Error('hook bug');
    });
    const path = manager.installedFile('06', 'address') as string;
    await manager.remove('06');
    expect(calls).toBe(1);
    expect(world.env.fs.files.has(path)).toBe(false);
    off();
    await manager.download('06', { parts: ['address'] });
    await manager.remove('06');
    expect(calls).toBe(1);
  });

  it('tells hooks nothing when there is nothing to delete', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    let calls = 0;
    manager.beforeDelete(async () => void (calls += 1));
    await manager.remove('06');
    expect(calls).toBe(0);
  });
});

describe('manifest storage problems', () => {
  it('reports a full disk when the manifest cannot be written and keeps the old one', async () => {
    const world = makeWorld();
    const fs: FsPort = { ...world.env.fs, writeAtomic: async (path, text) => (path.startsWith('manifest') ? Promise.reject(packError('no-space')) : world.env.fs.writeAtomic(path, text)) };
    const manager = await createPackManager({ fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, world.config);
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'no-space' });
    expect(manager.manifest()).toBeNull();
  });

  it('reports storage for other write failures', async () => {
    const world = makeWorld();
    const fs: FsPort = { ...world.env.fs, writeAtomic: async (path, text) => (path.startsWith('manifest') ? Promise.reject(new Error('io')) : world.env.fs.writeAtomic(path, text)) };
    const manager = await createPackManager({ fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, world.config);
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'storage' });
  });

  it('returns no diff on the first fetch and a diff afterwards', async () => {
    const { world, manager } = await setup();
    expect(await manager.checkUpdates()).toEqual({ ok: true, updates: [], diff: null });
    world.setPart('06', 'address', blob(10_100, 61));
    world.publish();
    expect(await manager.checkUpdates()).toMatchObject({ ok: true, diff: { added: [], removed: [], changed: [{ id: '06', kinds: ['address'] }], baseChanged: false } });
  });

  it('does not fetch the signature when the manifest itself is missing', async () => {
    const { world, manager } = await setup();
    world.env.server.inject({ effect: { kind: 'status', status: 404 }, times: 2 });
    await manager.checkUpdates();
    expect(requested(world)).toEqual(['manifest-v2.json', 'manifest-v1.json']);
  });
});

describe('removal leftovers', () => {
  it('clears partial data of a failed download when the region is removed', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    world.env.server.inject({ effect: { kind: 'cut', afterBytes: 1_000 }, times: 1, match: (url) => url.includes('/tiles-') });
    world.env.server.inject({ effect: { kind: 'cut', afterBytes: 0 }, times: 40, match: (url) => url.includes('/tiles-') });
    await expect(manager.download('35')).rejects.toMatchObject({ code: 'network' });
    expect([...world.env.fs.files.keys()].some((p) => p.startsWith('.part/'))).toBe(true);
    await manager.remove('35');
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('.part/') || p.startsWith('files/'))).toEqual([]);
  });

  it('keeps the base pack while another queued download needs it', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const first = manager.download('34');
    const second = manager.download('35');
    await manager.remove('35');
    await expect(second).rejects.toBeDefined();
    await first;
    expect(manager.baseDir()).toBe('files/base-20261022');
    expect(world.env.fs.files.has('files/base-20261022/overview.pmtiles')).toBe(true);
  });
});

describe('stored manifest check at start-up', () => {
  const verifyCalls = (): jest.SpyInstance => jest.spyOn(ed25519, 'verify');

  afterEach(() => jest.restoreAllMocks());

  it('checks the signature once when the manifest arrives and not again at later start-ups', async () => {
    const world = makeWorld();
    const spy = verifyCalls();
    const first = await setup(world);
    await first.manager.checkUpdates();
    expect(spy).toHaveBeenCalledTimes(1);
    const second = await setup(world);
    const third = await setup(world);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.manager.manifest()).toEqual(first.manager.manifest());
    expect(third.manager.regions().length).toBe(3);
  });

  it('checks again when the manifest file changed, when the signature file changed and when the trusted keys changed', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    const spy = verifyCalls();
    const manifest = world.env.fs.files.get('manifest-v1.json') as Uint8Array;
    world.env.fs.files.set('manifest-v1.json', new TextEncoder().encode(`${new TextDecoder().decode(manifest)} `));
    expect((await setup(world)).manager.manifest()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    world.env.fs.files.set('manifest-v1.json', manifest);
    const sig = world.env.fs.files.get('manifest-v1.json.sig') as Uint8Array;
    world.env.fs.files.set('manifest-v1.json.sig', new TextEncoder().encode('AAAA'));
    expect((await setup(world)).manager.manifest()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    world.env.fs.files.set('manifest-v1.json.sig', sig);
    const other = makeWorld().config.publicKeys;
    const rotated = await createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, { ...world.config, publicKeys: other });
    expect(rotated.manifest()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('still refuses a stored manifest that needs a newer SDK, even when nothing changed', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    const spy = verifyCalls();
    const old = await createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, { ...world.config, sdkVersion: '0.0.1' });
    expect(old.manifest()).toBeNull();
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it('keeps working when the state file has no record of a check', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    await world.env.fs.writeAtomic('state.json', JSON.stringify({ v: 1, regions: {}, base: null, pending: {}, dismissed: [] }));
    const spy = verifyCalls();
    expect((await setup(world)).manager.manifest()).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
