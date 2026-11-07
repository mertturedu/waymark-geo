import { blob, makeWorld } from '../helpers/pack-world';
import { requested, setup, stored } from '../helpers/pack-setup';

const fonts = (count: number): Record<string, Uint8Array> => ({
  'overview.pmtiles': blob(9_000, 8),
  ...Object.fromEntries(Array.from({ length: count }, (_, i) => [`fonts/Noto/${i}-${i + 255}.pbf`, blob(40 + i, i + 1)])),
});

describe('base pack with many small files', () => {
  it('installs every small file and reports steady progress', async () => {
    const world = makeWorld({ base: fonts(60) });
    const { manager } = await setup(world);
    const seen: number[] = [];
    await manager.download('34', { onProgress: (done, total) => seen.push(done / total) });
    for (let i = 0; i < 60; i++) expect(stored(world, `files/base-20261022/fonts/Noto/${i}-${i + 255}.pbf`)).toEqual(Array.from(world.base[`fonts/Noto/${i}-${i + 255}.pbf`] ?? []));
    expect(manager.status('34')).toMatchObject({ state: 'installed', progress: null, error: null });
    expect(requested(world).filter((path) => path.includes('fonts/'))).toHaveLength(60);
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((value, index) => index === 0 || value >= (seen[index - 1] as number) - 1e-9)).toBe(true);
    expect([...world.env.fs.files.keys()].filter((path) => path.startsWith('.part/'))).toEqual([]);
  });

  it('fails the whole job with the first error when one small file is wrong', async () => {
    const world = makeWorld({ base: fonts(30) });
    const { manager } = await setup(world);
    world.env.server.put(`${world.baseUrl}/base-20261022/fonts/Noto/7-262.pbf`, new Uint8Array(47).fill(1));
    await expect(manager.download('34')).rejects.toMatchObject({ code: 'checksum' });
    expect(manager.status('34')).toMatchObject({ state: 'error', error: { code: 'checksum' } });
    expect(manager.installedFile('34', 'address')).toBeNull();
  });

  it('can be paused while small files are downloading and then resumes to a full install', async () => {
    const world = makeWorld({ base: fonts(40) });
    const { manager } = await setup(world);
    const first = manager.download('34', { onProgress: (done, total) => done > 0 && done < total && void manager.pause('34') });
    await first.catch(() => undefined);
    expect(['paused', 'installed']).toContain(manager.status('34').state);
    await manager.download('34');
    expect(manager.status('34').state).toBe('installed');
    expect(stored(world, 'files/base-20261022/fonts/Noto/39-294.pbf')).toEqual(Array.from(world.base['fonts/Noto/39-294.pbf'] ?? []));
  });
});
