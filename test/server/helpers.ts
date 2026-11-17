import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemblePacks, type RegionInput } from '../../pipeline/build/manifest';
import { builtPack } from '../address/helpers/search-fixture';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };

let made: Promise<string> | null = null;

export function packsDir(): Promise<string> {
  made ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'geo-server-'));
    const baseDir = join(dir, 'base');
    mkdirSync(join(baseDir, 'sprites'), { recursive: true });
    writeFileSync(join(baseDir, 'overview.pmtiles'), 'harita');
    const regions: RegionInput[] = [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [27.9, 40.7, 30, 41.7], stats: { addresses: 3, streets: 2, neighbourhoods: 1 }, files: [{ kind: 'address', source: await builtPack() }] }];
    const outDir = join(dir, 'packs');
    await assemblePacks({ outDir, sources, regions, baseDir, keyDir: join(dir, 'keys'), minSdk: '0.1.0' });
    return outDir;
  })();
  return made;
}
