import { createGeo, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore } from '../../src/core/learn/store';
import { builtPack, turkeyBorders } from '../address/helpers/search-fixture';
import { sampleSource } from '../address/helpers/neighbourhood-fixture';
import { blob, makeWorld } from '../helpers/pack-world';
import { bytesOf } from '../helpers/real-world';
import { nodeOpener } from '../helpers/node-opener';

async function world() {
  return makeWorld({ regions: [{ id: '34', parts: { address: bytesOf(await builtPack()), tiles: blob(5_000, 3) } }] });
}

const envOf = (w: Awaited<ReturnType<typeof world>>, extra: Partial<GeoEnv> = {}): GeoEnv => ({ fs: w.env.fs, net: w.env.net, hash: w.env.hash, clock: w.env.clock, connectivity: w.env.connectivity, opener: nodeOpener(w), learnStore: memoryStore(), borders: turkeyBorders(), ...extra });

describe('geo with a neighbourhood directory', () => {
  it('uses the directory the app gives it', async () => {
    const w = await world();
    const source = sampleSource();
    const geo = await createGeo(w.config, envOf(w, { neighbourhoods: source }));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const checked = await geo.search.validate('Zeytin Sokak 5 Hasanpaşa Mahallesi Kadıköy 34660');
    expect(checked.notes.map((n) => n.code)).toContain('postcode_mismatch');
    expect(source.loads).toEqual(['34']);
    await geo.dispose();
  });

  it('behaves as before without one', async () => {
    const w = await world();
    const geo = await createGeo(w.config, envOf(w));
    await geo.regions.checkUpdates();
    await geo.regions.download('34', { parts: ['address'] });
    const checked = await geo.search.validate('Zeytin Sokak 5 Hasanpaşa Mahallesi Kadıköy 34660');
    expect(checked.notes.map((n) => n.code)).not.toContain('postcode_mismatch');
    await geo.dispose();
  });
});
