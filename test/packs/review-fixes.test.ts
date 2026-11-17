import { createPackManager } from '../../src/core/packs/manager';
import type { HashPort } from '../../src/core/packs/ports';
import { blob, makeWorld } from '../helpers/pack-world';

describe('a manifest that changes while a download runs', () => {
  it('records the files the job downloaded, not the ones the new manifest names', async () => {
    const world = makeWorld();
    let manager: Awaited<ReturnType<typeof createPackManager>> | null = null;
    let fired = false;
    const hash: HashPort = {
      sha256File: async (path) => {
        if (!path.startsWith('manifest') && !fired) {
          fired = true;
          world.setPart('35', 'address', blob(21_000, 9));
          world.publish();
          await manager?.checkUpdates();
        }
        return world.env.hash.sha256File(path);
      },
    };
    manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash, clock: world.env.clock, connectivity: world.env.connectivity }, world.config);
    await manager.download('35');
    const file = manager.installedFile('35', 'address');
    expect(file).not.toBeNull();
    expect(world.env.fs.files.has(file as string)).toBe(true);
    expect(manager.status('35').availableVersion).not.toBeNull();
  });
});

describe('asking for more parts while a download runs', () => {
  it('installs the parts of the second request as well', async () => {
    const world = makeWorld();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    const hash: HashPort = { sha256File: async (path) => { if (!path.startsWith('manifest') && !held) { held = true; await gate; } return world.env.hash.sha256File(path); } };
    const manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash, clock: world.env.clock, connectivity: world.env.connectivity }, world.config);
    const first = manager.download('34', { parts: ['address'] });
    for (let i = 0; i < 500 && !held; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held).toBe(true);
    const second = manager.download('34', { parts: ['buildings'] });
    release();
    await Promise.all([first, second]);
    expect(manager.status('34').installedParts).toEqual(['address', 'buildings']);
  });
});

describe('a flaky connection that keeps delivering bytes', () => {
  it('counts only failures in a row against the retry limit', async () => {
    const { downloadFile } = await import('../../src/core/packs/download');
    const { createFakeEnv } = await import('../helpers/fake-env');
    const { sha256 } = await import('@noble/hashes/sha256');
    const { bytesToHex } = await import('@noble/hashes/utils');
    const env = createFakeEnv({});
    const bytes = blob(100_000, 3);
    const url = 'https://packs.example/34/address-0a0b0c0d.sqlite';
    env.server.put(url, bytes);
    env.server.inject({ effect: { kind: 'cut', afterBytes: 1000 }, times: 8 });
    const result = await downloadFile({ fs: env.fs, net: env.net, hash: env.hash, clock: env.clock, url, partPath: '.part/a', finalPath: 'files/a', size: bytes.length, sha256: bytesToHex(sha256(bytes)) });
    expect(result.bytes).toBe(bytes.length);
    expect(result.retries).toBe(8);
  });

  it('still gives up after the limit when nothing arrives between failures', async () => {
    const { downloadFile } = await import('../../src/core/packs/download');
    const { createFakeEnv } = await import('../helpers/fake-env');
    const env = createFakeEnv({});
    const bytes = blob(10_000, 3);
    const url = 'https://packs.example/34/address-0a0b0c0d.sqlite';
    env.server.put(url, bytes);
    env.server.inject({ effect: { kind: 'cut', afterBytes: 0 }, times: 20 });
    await expect(downloadFile({ fs: env.fs, net: env.net, hash: env.hash, clock: env.clock, url, partPath: '.part/a', finalPath: 'files/a', size: bytes.length, sha256: 'x'.repeat(64) })).rejects.toMatchObject({ code: 'network' });
  });
});

describe('an optional part that arrives after the address pack was opened', () => {
  it('tells the listeners that the province changed', async () => {
    const { createManagedPackStore } = await import('../../src/core/packs/store');
    const { nodeOpener } = await import('../helpers/node-opener');
    const { packWorld } = await import('../helpers/real-world');
    const { setup } = await import('../helpers/pack-setup');
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    expect(await store.open('34')).not.toBeNull();
    expect(await store.openPart?.('34', 'buildings')).toBeNull();
    const heard: string[] = [];
    store.onChange((plate) => heard.push(plate));
    await manager.download('34', { parts: ['address', 'buildings'] });
    expect(heard).toEqual(['34']);
    expect(await store.openPart?.('34', 'buildings')).not.toBeNull();
    await store.closeAll();
  });
});
