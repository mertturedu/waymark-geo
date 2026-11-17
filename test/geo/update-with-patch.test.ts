import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePatch, zstdPatchTool } from '../../pipeline/build/patches';
import { createGeo, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore } from '../../src/core/learn/store';
import { turkeyBorders } from '../address/helpers/search-fixture';
import { nodeOpener } from '../helpers/node-opener';
import type { World } from '../helpers/pack-world';
import { packWorld } from '../helpers/real-world';

const hint = { hints: { city: 'İstanbul' } };

const envOf = (world: World): GeoEnv => ({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity, opener: nodeOpener(world), learnStore: memoryStore(), borders: turkeyBorders() });

describe('updating an address pack with a patch while the app keeps working', () => {
  it('answers searches from the old pack during the apply and from the new one after', async () => {
    const { world, v1, v2 } = await packWorld();
    const geo = await createGeo(world.config, envOf(world));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    expect((await geo.search.resolve('yeni sokak 9', hint)).status).not.toBe('resolved');

    const dir = mkdtempSync(join(tmpdir(), 'geo-patch-'));
    try {
      const patch = (await encodePatch(Buffer.from(v1), Buffer.from(v2), zstdPatchTool, dir))!;
      world.setPart('34', 'address', v2);
      world.addPatch('34', 'address', v1, patch);
      world.publish();
      await geo.regions.checkUpdates();
      expect(geo.regions.status('34')).toMatchObject({ state: 'update-available', updateBytes: patch.length });
      world.env.server.log.length = 0;

      const during: string[] = [];
      const sleep = world.env.clock.sleep;
      world.env.clock.sleep = async (ms) => {
        during.push((await geo.search.resolve('bahariye caddesi 14', hint)).status);
        return sleep(ms);
      };
      await geo.regions.download('34');
      world.env.clock.sleep = sleep;

      expect(during.length).toBeGreaterThan(0);
      expect(during.every((status) => status === 'resolved')).toBe(true);
      expect(world.env.server.log.some((request) => request.url.includes('/patches/'))).toBe(true);
      expect(world.env.server.log.some((request) => request.url.endsWith('.sqlite'))).toBe(false);
      expect(geo.regions.status('34').lastUpdate).toEqual({ patched: 1, fellBack: 0, bytes: patch.length });
      expect(await geo.search.resolve('yeni sokak 9', hint)).toMatchObject({ status: 'resolved', best: { components: { street: 'Yeni Sokak' } } });
      expect(await geo.search.resolve('bahariye caddesi 14', hint)).toMatchObject({ status: 'resolved' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await geo.dispose();
    }
  });
});
