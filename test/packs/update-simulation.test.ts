import { generateKeyPairSync } from 'node:crypto';
import { createLearning, memoryStore } from '../../src/core/learn';
import { blob } from '../helpers/pack-world';
import { requested, setup } from '../helpers/pack-setup';

const LEARNED = 'learn.sqlite';

async function installedWorld() {
  const ready = await setup();
  await ready.manager.download('35');
  ready.world.env.fs.files.set(LEARNED, Uint8Array.from([1, 2, 3, 4, 5]));
  const address = ready.manager.installedFile('35', 'address') as string;
  const tiles = ready.manager.installedFile('35', 'tiles') as string;
  const before = { address: Array.from(ready.world.env.fs.files.get(address) ?? []), tiles: Array.from(ready.world.env.fs.files.get(tiles) ?? []) };
  ready.world.setPart('35', 'address', blob(21_000, 55));
  ready.world.publish();
  await ready.manager.checkUpdates();
  return { ...ready, address, tiles, before };
}

const intact = (world: Awaited<ReturnType<typeof installedWorld>>): void => {
  const { world: w, manager, address, tiles, before } = world;
  expect(manager.installedFile('35', 'address')).toBe(address);
  expect(Array.from(w.env.fs.files.get(address) ?? [])).toEqual(before.address);
  expect(Array.from(w.env.fs.files.get(tiles) ?? [])).toEqual(before.tiles);
  expect(Array.from(w.env.fs.files.get(LEARNED) ?? [])).toEqual([1, 2, 3, 4, 5]);
};

describe('update from v1 to v2 (K8.4)', () => {
  const cuts = [1, 7_000, 20_999];

  it.each(cuts)('resumes a download cut after %i bytes and ends with v2 only, v1 intact until then', async (after) => {
    const sim = await installedWorld();
    const url = sim.world.pathOf('35', 'address');
    intact(sim);
    sim.world.env.server.inject({ effect: { kind: 'cut', afterBytes: after }, match: (u) => u.includes(url), times: 1000 });
    sim.world.env.server.log.length = 0;
    await sim.manager.download('35');
    expect(sim.manager.status('35')).toMatchObject({ state: 'installed', availableVersion: null });
    expect(sim.world.env.server.log.filter((r) => r.url.includes(url)).length).toBeGreaterThan(1);
    expect(sim.world.env.fs.files.has(sim.address)).toBe(false);
    expect(Array.from(sim.world.env.fs.files.get(LEARNED) ?? [])).toEqual([1, 2, 3, 4, 5]);
  });

  it('gives up when a cut makes no progress at all, keeps v1 and finishes once the link works', async () => {
    const sim = await installedWorld();
    sim.world.env.server.inject({ effect: { kind: 'cut', afterBytes: 0 }, match: (u) => u.includes(sim.world.pathOf('35', 'address')), times: 1000 });
    await expect(sim.manager.download('35')).rejects.toMatchObject({ code: 'network' });
    intact(sim);
    sim.world.env.server.clear();
    await sim.manager.download('35');
    expect(sim.manager.status('35').state).toBe('installed');
    expect(Array.from(sim.world.env.fs.files.get(LEARNED) ?? [])).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps v1 usable when the network drops or the server answers with an error', async () => {
    for (const effect of [{ kind: 'offline' as const }, { kind: 'status' as const, status: 500 }]) {
      const sim = await installedWorld();
      sim.world.env.server.inject({ effect, match: (u) => u.includes(sim.world.pathOf('35', 'address')), times: 1000 });
      await expect(sim.manager.download('35')).rejects.toBeDefined();
      intact(sim);
    }
  });

  it('keeps v1 usable when the new file arrives damaged and never installs it', async () => {
    const sim = await installedWorld();
    const damaged = blob(21_000, 55).slice();
    damaged[100] = (damaged[100] as number) ^ 1;
    sim.world.env.server.inject({ effect: { kind: 'body', bytes: damaged }, match: (u) => u.includes(sim.world.pathOf('35', 'address')), times: 1000 });
    await expect(sim.manager.download('35')).rejects.toMatchObject({ code: 'checksum' });
    intact(sim);
    expect(sim.manager.status('35').installedVersion).not.toBe(sim.manager.status('35').availableVersion);
  });

  it('downloads only the changed file, even after one interrupted attempt', async () => {
    const sim = await installedWorld();
    const url = sim.world.pathOf('35', 'address');
    sim.world.env.server.inject({ effect: { kind: 'cut', afterBytes: 9_000 }, match: (u) => u.includes(url), times: 1 });
    sim.world.env.server.log.length = 0;
    await sim.manager.download('35').catch(() => undefined);
    await sim.manager.download('35');
    const files = requested(sim.world).filter((p) => !p.startsWith('manifest'));
    expect(files.every((p) => p === url)).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });

  it('leaves what the learning store knows alone while the packs are replaced', async () => {
    const sim = await installedWorld();
    const store = memoryStore();
    const learning = await createLearning({ store });
    const place = { id: '35:a:1', label: 'Kıbrıs Şehitleri Caddesi No:5, Alsancak Mah., Konak/İzmir', components: { province: 'İzmir', district: 'Konak', neighbourhood: 'Alsancak', street: 'Kıbrıs Şehitleri Caddesi', houseNumber: '5' }, coordinate: [27.14, 38.43] as [number, number], precision: 'interpolated' as const, approximate: true, source: 'interpolated' as const, confidence: 0.8, region: '35' };
    const first = await learning.confirm({ place, point: [27.141, 38.431], source: 'pin' });
    const before = learning.exportLines();
    await sim.manager.download('35');
    expect(first.ok).toBe(true);
    expect(learning.exportLines()).toEqual(before);
    expect(before.length).toBeGreaterThan(0);
  });
});

describe('tampering is refused (K8.5)', () => {
  it('rejects a manifest changed after signing and keeps the state', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    world.publish({ tamper: true });
    expect(await manager.checkUpdates()).toMatchObject({ ok: false, code: 'signature' });
    expect(manager.status('06').state).toBe('installed');
  });

  it('rejects a manifest checked against the wrong key', async () => {
    const world = (await setup()).world;
    const other = String(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    world.config.publicKeys = [other];
    const wrong = await setup(world);
    expect(await wrong.manager.checkUpdates()).toMatchObject({ ok: false, code: 'signature' });
  });

  it('rejects a file whose bytes differ from the signed manifest', async () => {
    const { world, manager } = await setup();
    const wrongBytes = blob(10_000, 99);
    world.env.server.inject({ effect: { kind: 'body', bytes: wrongBytes }, match: (u) => u.includes(world.pathOf('06', 'address')), times: 1000 });
    await expect(manager.download('06')).rejects.toMatchObject({ code: 'checksum' });
    expect(manager.status('06').installedParts).toEqual([]);
  });
});
