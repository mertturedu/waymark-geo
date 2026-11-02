import { loadState } from '../../src/core/packs/state-file';
import type { HashPort } from '../../src/core/packs/ports';
import { createPackManager } from '../../src/core/packs/manager';
import { blob, makeWorld } from '../helpers/pack-world';
import { requested, setup } from '../helpers/pack-setup';

describe('what a download covers', () => {
  it('keeps the base pack out of an address-only install', async () => {
    const { world, manager } = await setup();
    await manager.download('06', { parts: ['address'] });
    expect(manager.baseDir()).toBeNull();
    expect((await loadState(world.env.fs)).state.base).toBeNull();
  });

  it('counts only the files still missing in the progress total', async () => {
    const { manager } = await setup();
    await manager.download('34');
    const totals: number[] = [];
    await manager.download('35', { onProgress: (_done, total) => totals.push(total) });
    expect(new Set(totals)).toEqual(new Set([60_000]));
  });

  it('shows the verifying state while the last file is hashed, not the earlier ones', async () => {
    const world = makeWorld();
    const seen: string[] = [];
    let manager: Awaited<ReturnType<typeof createPackManager>> | null = null;
    const hash: HashPort = { sha256File: async (path) => { if (path.startsWith('manifest')) return world.env.hash.sha256File(path); seen.push(`${manager?.status('35').state}:${path.split('/').pop()?.split('-')[0]}`); return world.env.hash.sha256File(path); } };
    manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash, clock: world.env.clock, connectivity: world.env.connectivity }, world.config);
    await manager.download('35');
    expect(seen.slice(0, -1).every((line) => line.startsWith('downloading:'))).toBe(true);
    expect(seen.at(-1)?.startsWith('verifying:')).toBe(true);
    expect(seen).toHaveLength(4);
  });

  it('adopts the installed parts when no parts are named and fetches nothing new', async () => {
    const { world, manager } = await setup();
    await manager.download('06', { parts: ['address'] });
    world.env.server.log.length = 0;
    await manager.download('06');
    expect(requested(world)).toEqual([]);
    expect(manager.status('06').installedParts).toEqual(['address']);
  });

  it('fetches the base pack again for an installed map when the base went missing', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    world.env.fs.files.delete('files/base-20261022/overview.pmtiles');
    const second = await setup(world);
    world.env.server.log.length = 0;
    await second.manager.download('34');
    expect(requested(world)).toEqual(['base-20261022/overview.pmtiles']);
    expect(second.manager.baseDir()).toBe('files/base-20261022');
  });

  it('names the problem when the region or the part does not exist', async () => {
    const { manager } = await setup();
    await manager.checkUpdates();
    await expect(manager.download('77')).rejects.toMatchObject({ message: 'unknown region 77' });
    await expect(manager.download('35', { parts: ['buildings'] })).rejects.toMatchObject({ message: 'region 35 has no buildings part' });
    await expect(manager.resume('35')).resolves.toBeUndefined();
  });

  it('resumes only the parts that were pending', async () => {
    const world = makeWorld();
    await setup(world).then((s) => s.manager.checkUpdates());
    const { writeAtomic } = world.env.fs;
    await writeAtomic('state.json', JSON.stringify({ v: 1, regions: {}, base: null, pending: { '06': { parts: ['address'] } }, dismissed: [] }));
    const { manager } = await setup(world);
    world.env.server.log.length = 0;
    await manager.resume('06');
    expect(manager.status('06').installedParts).toEqual(['address']);
    expect(requested(world).some((p) => p.includes('tiles'))).toBe(false);
  });
});

describe('missing base bytes', () => {
  it('counts the base pack until it is installed and again when it changes', async () => {
    const { world, manager } = await setup();
    expect(manager.missingBaseBytes()).toBe(0);
    await manager.checkUpdates();
    expect(manager.missingBaseBytes()).toBe(9_300);
    await manager.download('06');
    expect(manager.missingBaseBytes()).toBe(0);
    world.base['overview.pmtiles'] = blob(9_500, 90);
    world.publish();
    await manager.checkUpdates();
    expect(manager.missingBaseBytes()).toBe(9_500);
  });
});

describe('installed regions', () => {
  it('lists the regions that have an address part, in plate order', async () => {
    const { manager } = await setup();
    expect(manager.installedRegions()).toEqual([]);
    await manager.download('35', { parts: ['address'] });
    await manager.download('06', { parts: ['address'] });
    expect(manager.installedRegions()).toEqual(['06', '35']);
    await manager.remove('06', ['address']);
    expect(manager.installedRegions()).toEqual(['35']);
  });
});

describe('versions on show', () => {
  it('exposes the available version for an outdated region and null otherwise', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    expect(manager.status('35').availableVersion).toBeNull();
    expect(manager.status('06').availableVersion).toBeNull();
    world.setPart('35', 'address', blob(21_000, 71));
    world.publish();
    await manager.checkUpdates();
    const available = manager.regions().find((r) => r.id === '35')?.version;
    expect(manager.status('35').availableVersion).toBe(available);
    expect(manager.status('06').availableVersion).toBeNull();
  });
});

describe('a new base build', () => {
  it('replaces the base folder and tells the hooks about the old files', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    world.setBuild('20261105');
    world.publish();
    const closed: string[][] = [];
    manager.beforeDelete(async (paths) => void closed.push(paths));
    await manager.checkUpdates();
    await manager.download('06');
    expect(manager.baseDir()).toBe('files/base-20261105');
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('files/base-')).every((p) => p.startsWith('files/base-20261105/'))).toBe(true);
    expect(closed.flat().sort()).toEqual(['files/base-20261022/overview.pmtiles', 'files/base-20261022/sprites/v4/light.json'].concat(closed.flat().filter((p) => !p.includes('base-'))).sort());
  });
});

describe('removal in detail', () => {
  it('tells the hooks exactly which files go', async () => {
    const { manager } = await setup();
    await manager.download('34', { parts: ['address', 'tiles', 'buildings'] });
    const heard: string[][] = [];
    manager.beforeDelete(async (paths) => void heard.push([...paths]));
    const expected = ['address', 'tiles', 'buildings'].map((k) => manager.installedFile('34', k as 'address') as string).concat(['files/base-20261022/overview.pmtiles', 'files/base-20261022/sprites/v4/light.json']);
    await manager.remove('34');
    expect(heard).toHaveLength(1);
    expect((heard[0] ?? []).sort()).toEqual(expected.sort());
  });

  it('forgets the pending record of a paused region', async () => {
    const { world, manager } = await setup();
    await manager.checkUpdates();
    const running = manager.download('35', { onProgress: (d) => d > 10_000 && void manager.pause('35') });
    await expect(running).rejects.toBeDefined();
    await manager.remove('35');
    expect((await loadState(world.env.fs)).state.pending).toEqual({});
    expect(manager.status('35').state).toBe('none');
  });

  it('keeps an outdated region marked outdated after a partial removal and an up to date one installed', async () => {
    const { world, manager } = await setup();
    await manager.download('35', { parts: ['address', 'tiles', 'buildings'].filter((k) => k !== 'buildings') as ('address' | 'tiles')[] });
    await manager.remove('35', ['tiles']);
    expect(manager.status('35')).toMatchObject({ state: 'installed', installedParts: ['address'] });
    world.setPart('35', 'address', blob(21_000, 72));
    world.publish();
    await manager.checkUpdates();
    expect(manager.status('35').state).toBe('update-available');
    await manager.remove('35', ['buildings']);
    expect(manager.status('35').state).toBe('update-available');
  });

  it('notifies listeners while removing', async () => {
    const { manager } = await setup();
    await manager.download('06', { parts: ['address'] });
    let heard = 0;
    manager.subscribe(() => void (heard += 1));
    await manager.remove('06');
    expect(heard).toBeGreaterThan(0);
  });

  it('tells an idle caller to wait while a download runs', async () => {
    const world = makeWorld();
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const net = { ...world.env.net, get: async (...args: Parameters<typeof world.env.net.get>) => { await gate; return world.env.net.get(...args); } };
    const { manager } = await setup(world, { net });
    await manager.checkUpdates();
    let drained = false;
    const running = manager.download('06');
    void manager.idle().then(() => void (drained = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(drained).toBe(false);
    open();
    await running;
    await manager.idle();
    expect(drained).toBe(true);
  });
});

describe('start-up with unknown manifest or untrusted state', () => {
  it('keeps partial downloads while no manifest is known', async () => {
    const world = makeWorld();
    await world.env.fs.append('.part/anything__else.bin', new Uint8Array(50));
    await setup(world);
    expect(world.env.fs.files.has('.part/anything__else.bin')).toBe(true);
  });

  it('leaves unknown files alone when the state could not be read', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    await world.env.fs.writeAtomic('state.json', 'junk');
    await world.env.fs.append('files/99/stray.sqlite', new Uint8Array(10));
    await setup(world);
    expect(world.env.fs.files.has('files/99/stray.sqlite')).toBe(true);
  });
});

describe('the places overlay part', () => {
  const worldWithPlaces = () => makeWorld({ regions: [{ id: '20', parts: { address: blob(10_000, 1), tiles: blob(20_000, 2), places: blob(4_000, 3) } }, { id: '06', tier: 'basic', parts: { address: blob(5_000, 4), tiles: blob(8_000, 5) } }] });

  it('comes with the map by default when the region has it', async () => {
    const { manager } = await setup(worldWithPlaces());
    await manager.download('20');
    expect(manager.status('20').installedParts).toEqual(['address', 'tiles', 'places']);
    expect(manager.installedFile('20', 'places')).toMatch(/^files\/20\/places-.*\.pmtiles$/);
  });

  it('is not asked for when the region does not have it', async () => {
    const { manager } = await setup(worldWithPlaces());
    await manager.download('06');
    expect(manager.status('06').installedParts).toEqual(['address', 'tiles']);
  });

  it('stays out of an address-only install and can be added and removed on its own', async () => {
    const { world, manager } = await setup(worldWithPlaces());
    await manager.download('20', { parts: ['address'] });
    expect(requested(world).some((p) => p.includes('places-'))).toBe(false);
    await manager.download('20', { parts: ['address', 'tiles', 'places'] });
    expect(manager.status('20').installedParts).toEqual(['address', 'tiles', 'places']);
    await manager.remove('20', ['places']);
    expect(manager.status('20').installedParts).toEqual(['address', 'tiles']);
    expect(manager.status('20').state).toBe('installed');
  });

  it('is counted when an installed region updates', async () => {
    const world = worldWithPlaces();
    const { manager } = await setup(world);
    await manager.download('20');
    world.setPart('20', 'places', blob(4_100, 9));
    world.publish();
    await manager.checkUpdates();
    expect(manager.status('20').state).toBe('update-available');
    await manager.download('20');
    expect(manager.status('20')).toMatchObject({ state: 'installed', availableVersion: null });
  });
});
