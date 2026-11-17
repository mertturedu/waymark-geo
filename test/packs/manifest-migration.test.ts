import { createPackManager, type PackManager } from '../../src/core/packs/manager';
import { blob, makeWorld, type World } from '../helpers/pack-world';

async function open(world: World, extra: { manifestUrl?: string } = {}): Promise<PackManager> {
  return createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, { ...world.config, ...extra });
}

const requested = (world: World): string[] => world.env.server.log.map((r) => r.url.replace(`${world.baseUrl}/`, ''));

describe('a world that has the new part: manifest-v2 and manifest-v1', () => {
  const regions = () => [
    { id: '34', parts: { address: blob(30_000, 1), tiles: blob(50_000, 2), buildings2: blob(9_000, 3) } },
    { id: '35', tier: 'basic' as const, parts: { address: blob(20_000, 4), tiles: blob(40_000, 5) } },
  ];

  it('serves the new part only in manifest-v2 and keeps manifest-v1 as the old SDKs read it', async () => {
    const world = makeWorld({ regions: regions() });
    const v1 = JSON.parse(new TextDecoder().decode(world.env.server.read(world.manifestUrl)));
    const v2 = JSON.parse(new TextDecoder().decode(world.env.server.read(world.manifestV2Url)));
    expect(v1.format).toBe(1);
    expect(v1.regions.flatMap((r: { files: { kind: string }[] }) => r.files.map((f) => f.kind))).not.toContain('buildings2');
    expect(v2.format).toBe(2);
    expect(v2.regions.flatMap((r: { files: { kind: string }[] }) => r.files.map((f) => f.kind))).toContain('buildings2');
  });

  it('reads manifest-v2 first, installs the new part with the others and lists it', async () => {
    const world = makeWorld({ regions: regions() });
    const manager = await open(world);
    expect(await manager.checkUpdates()).toMatchObject({ ok: true });
    expect(requested(world)).toEqual(['manifest-v2.json', 'manifest-v2.json.sig']);
    expect(manager.manifest()?.format).toBe(2);
    await manager.download('34');
    expect(manager.status('34').installedParts).toEqual(['address', 'tiles', 'buildings2']);
    expect(manager.installedFile('34', 'buildings2')).toMatch(/buildings2-[0-9a-f]{8}\.sqlite$/);
    expect(world.env.fs.files.has('manifest-v2.json')).toBe(true);
  });

  it('keeps working from the stored manifest-v2 after a restart', async () => {
    const world = makeWorld({ regions: regions() });
    await (await open(world)).checkUpdates();
    const again = await open(world);
    expect(again.manifest()?.format).toBe(2);
    expect(again.regions().map((r) => r.id)).toEqual(['34', '35']);
  });
});

describe('moving from an SDK that only knew manifest-v1', () => {
  it('loads the stored manifest-v1 at start, then takes manifest-v2 and installs the new part into a region that is already there', async () => {
    const old = [{ id: '34', parts: { address: blob(30_000, 1), tiles: blob(50_000, 2) } }];
    const world = makeWorld({ regions: old });
    const before = await open(world);
    await before.checkUpdates();
    await before.download('34');
    expect(before.status('34').installedParts).toEqual(['address', 'tiles']);
    world.env.server.remove(world.manifestV2Url);

    const upgraded = await open(world);
    expect(upgraded.manifest()?.format).toBe(1);
    expect(upgraded.status('34').state).toBe('installed');

    (world.regions[0] as { parts: Record<string, Uint8Array> }).parts.buildings2 = blob(9_000, 3);
    world.publish();
    const found = await upgraded.checkUpdates();
    expect(found).toMatchObject({ ok: true, updates: [] });
    expect(upgraded.manifest()?.format).toBe(2);
    expect(upgraded.status('34').state).toBe('installed');
    await upgraded.download('34', { parts: ['address', 'tiles', 'buildings2'] });
    expect(upgraded.status('34').installedParts).toEqual(['address', 'tiles', 'buildings2']);
    expect(upgraded.status('34').state).toBe('installed');
  });

  it('keeps asking manifest-v1 when the server has no manifest-v2 yet', async () => {
    const world = makeWorld();
    const manager = await open(world);
    expect(await manager.checkUpdates()).toMatchObject({ ok: true });
    expect(requested(world)).toEqual(['manifest-v2.json', 'manifest-v1.json', 'manifest-v1.json.sig']);
    expect(manager.manifest()?.format).toBe(1);
  });

  it('reads exactly the file it was told to when the URL is not the default one', async () => {
    const world = makeWorld({ regions: [{ id: '34', parts: { address: blob(30_000, 1), tiles: blob(50_000, 2), buildings2: blob(9_000, 3) } }] });
    const manager = await open(world, { manifestUrl: world.manifestV2Url });
    expect(await manager.checkUpdates()).toMatchObject({ ok: true });
    expect(requested(world)).toEqual(['manifest-v2.json', 'manifest-v2.json.sig']);
    const other = await open(world, { manifestUrl: `${world.baseUrl}/custom.json` });
    expect(await other.checkUpdates()).toEqual({ ok: false, code: 'http-404' });
  });

  it('stops on a server error of manifest-v2 instead of falling back', async () => {
    const world = makeWorld();
    const manager = await open(world);
    world.env.server.inject({ effect: { kind: 'status', status: 503 }, times: 1 });
    expect(await manager.checkUpdates()).toEqual({ ok: false, code: 'http' });
    expect(requested(world)).toEqual(['manifest-v2.json']);
  });
});
