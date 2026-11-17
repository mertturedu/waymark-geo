import { blob, makeWorld } from '../helpers/pack-world';
import { requested, setup, stored } from '../helpers/pack-setup';
import { createPackManager } from '../../src/core/packs/manager';

const fonts = (count: number): Record<string, Uint8Array> => ({
  'overview.pmtiles': blob(9_000, 8),
  ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`fonts/Noto/${i}-${i + 255}.pbf`, blob(40 + i, i + 1)])),
});

describe('base pack on its own', () => {
  it('installs the base without any region', async () => {
    const world = makeWorld({ base: fonts(12) });
    const { manager } = await setup(world);
    expect(manager.baseDir()).toBeNull();
    expect(manager.baseReady()).toBe(false);
    await manager.downloadBase();
    expect(manager.baseReady()).toBe(true);
    expect(manager.baseDir()).toBe('files/base-20261022');
    expect(stored(world, 'files/base-20261022/overview.pmtiles')).toEqual(Array.from(world.base['overview.pmtiles'] ?? []));
    expect(manager.installedRegions()).toEqual([]);
    expect(manager.installedFile('34', 'tiles')).toBeNull();
    expect(manager.missingBaseBytes()).toBe(0);
  });

  it('does not touch the status of any province', async () => {
    const world = makeWorld({ base: fonts(4) });
    const { manager } = await setup(world);
    await manager.downloadBase();
    for (const region of manager.regions()) expect(manager.status(region.id).state).toBe('none');
  });

  it('is a no-op once the base is complete', async () => {
    const world = makeWorld({ base: fonts(4) });
    const { manager } = await setup(world);
    await manager.downloadBase();
    const before = requested(world).length;
    await manager.downloadBase();
    expect(requested(world)).toHaveLength(before);
  });

  it('shares one job between concurrent calls', async () => {
    const world = makeWorld({ base: fonts(8) });
    const { manager } = await setup(world);
    await Promise.all([manager.downloadBase(), manager.downloadBase()]);
    expect(requested(world).filter((path) => path.includes('overview.pmtiles'))).toHaveLength(1);
  });

  it('reports progress up to the full size', async () => {
    const world = makeWorld({ base: fonts(6) });
    const { manager } = await setup(world);
    const seen: number[] = [];
    await manager.downloadBase({ onProgress: (done, total) => seen.push(done / total) });
    expect(seen.at(-1)).toBe(1);
  });

  it('lets a region reuse the base that is already there', async () => {
    const world = makeWorld({ base: fonts(5) });
    const { manager } = await setup(world);
    await manager.downloadBase();
    const before = requested(world).filter((path) => path.includes('fonts/') || path.includes('overview')).length;
    await manager.download('34');
    expect(manager.status('34').state).toBe('installed');
    expect(requested(world).filter((path) => path.includes('fonts/') || path.includes('overview'))).toHaveLength(before);
  });

  it('fails with the checksum error and can be tried again', async () => {
    const world = makeWorld({ base: fonts(6) });
    const { manager } = await setup(world);
    world.env.server.put(`${world.baseUrl}/base-20261022/fonts/Noto/2-257.pbf`, new Uint8Array(42).fill(1));
    await expect(manager.downloadBase()).rejects.toMatchObject({ code: 'checksum' });
    expect(manager.baseReady()).toBe(false);
    world.env.server.put(`${world.baseUrl}/base-20261022/fonts/Noto/2-257.pbf`, world.base['fonts/Noto/2-257.pbf'] as Uint8Array);
    await manager.downloadBase();
    expect(manager.baseReady()).toBe(true);
  });
});

describe('removing the last region', () => {
  const build = async (keepBase: boolean) => {
    const world = makeWorld({ base: fonts(4) });
    const manager = await createPackManager(
      { fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity },
      { ...world.config, autoDownload: 'never', ...(keepBase ? { keepBase } : {}) },
    );
    return { world, manager };
  };

  it('drops the base by default', async () => {
    const { manager } = await build(false);
    await manager.download('34');
    await manager.remove('34');
    expect(manager.baseDir()).toBeNull();
  });

  it('keeps the base when it is streaming tiles', async () => {
    const { manager } = await build(true);
    await manager.download('34');
    await manager.remove('34');
    expect(manager.baseReady()).toBe(true);
    expect(manager.baseDir()).not.toBeNull();
  });
});
