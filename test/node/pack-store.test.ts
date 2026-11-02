import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { assemblePacks } from '../../pipeline/build/manifest';
import { createNodePackStore, createNodeRouteStore } from '../../src/node/pack-store';
import { baseRows, writeWork } from '../pipeline/helpers/mini-work';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };

async function packs(ids: string[], withBuildings = false, routeBytes?: Uint8Array): Promise<string> {
  const work = writeWork(baseRows());
  const pack = join(work, 'pack.sqlite');
  const stats = await buildAddressPack({ province: '34', workDir: work, outFile: pack, osmTimestamp: sources.osmTimestamp });
  const tiles = join(work, 'tiles.pmtiles');
  writeFileSync(tiles, 'karo');
  const baseDir = join(work, 'base');
  mkdirSync(baseDir);
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'x');
  const buildings = join(work, 'buildings.sqlite');
  const made = new DatabaseSync(buildings);
  made.exec("CREATE TABLE meta (k TEXT, v TEXT); CREATE TABLE building_cell (cell INTEGER, pts BLOB); INSERT INTO meta VALUES ('format', '1');");
  made.close();
  const route = join(work, 'route.bin');
  writeFileSync(route, routeBytes ?? Uint8Array.from([1, 2, 3]));
  const outDir = join(mkdtempSync(join(tmpdir(), 'store-')), 'packs');
  await assemblePacks({
    outDir, sources, baseDir, keyDir: join(work, 'keys'), minSdk: '0.1.0',
    regions: ids.map((id) => ({ id, tier: id === '34' ? ('full' as const) : ('basic' as const), names: { tr: id }, bbox: [27, 40, 30, 42] as [number, number, number, number], stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods }, files: [{ kind: 'address' as const, source: pack }, { kind: 'tiles' as const, source: tiles }, ...(withBuildings && id === '34' ? [{ kind: 'buildings' as const, source: buildings }] : []), ...(routeBytes && id === '34' ? [{ kind: 'route' as const, source: route }] : [])] })),
  });
  return outDir;
}

describe('createNodePackStore', () => {
  it('lists the regions of the manifest whose address file is on disk and opens them', async () => {
    const dir = await packs(['06', '34']);
    const store = await createNodePackStore(dir);
    expect(await store.installed()).toEqual(['06', '34']);
    const db = await store.open('34');
    expect(db).not.toBeNull();
    expect(await db?.all('SELECT COUNT(*) AS n FROM address')).toEqual([{ n: 8 }]);
    await db?.close();
  });

  it('gives null for a region that is not in the manifest', async () => {
    const store = await createNodePackStore(await packs(['34']));
    expect(await store.open('35')).toBeNull();
  });

  it('stops listing a region whose files were removed', async () => {
    const dir = await packs(['06', '34']);
    rmSync(join(dir, '06'), { recursive: true });
    const store = await createNodePackStore(dir);
    expect(await store.installed()).toEqual(['34']);
    expect(await store.open('06')).toBeNull();
  });

  it('opens the building part of a region that has one and says null otherwise', async () => {
    const store = await createNodePackStore(await packs(['06', '34'], true));
    const part = await store.openPart?.('34', 'buildings');
    expect(await part?.all('SELECT v FROM meta WHERE k = ?', ['format'])).toEqual([{ v: '1' }]);
    await part?.close();
    expect(await store.openPart?.('06', 'buildings')).toBeNull();
    expect(await (await createNodePackStore(await packs(['34']))).openPart?.('34', 'buildings')).toBeNull();
  });

  it('looks at the disk once and keeps its list for the life of the store', async () => {
    const dir = await packs(['06', '34']);
    const store = await createNodePackStore(dir);
    expect(await store.installed()).toEqual(['06', '34']);
    rmSync(join(dir, '06'), { recursive: true });
    expect(await store.installed()).toEqual(['06', '34']);
    expect(await (await createNodePackStore(dir)).installed()).toEqual(['34']);
  });

  it('reports a missing or broken manifest', async () => {
    await expect(createNodePackStore(mkdtempSync(join(tmpdir(), 'empty-')))).rejects.toThrow(/manifest-v1\.json/);
    const dir = mkdtempSync(join(tmpdir(), 'broken-'));
    writeFileSync(join(dir, 'manifest-v1.json'), '{oops');
    await expect(createNodePackStore(dir)).rejects.toThrow(/manifest/);
  });});

describe('createNodeRouteStore', () => {
  it('lists the regions that have a route file on disk and reads their bytes', async () => {
    const dir = await packs(['06', '34'], false, Uint8Array.from([7, 8, 9, 10]));
    const store = await createNodeRouteStore(dir);
    expect(await store.installed()).toEqual(['34']);
    expect(Array.from((await store.read('34')) as Uint8Array)).toEqual([7, 8, 9, 10]);
    expect(await store.read('06')).toBeNull();
    expect(await store.read('35')).toBeNull();
  });

  it('says nothing is installed when the manifest has no route part', async () => {
    const store = await createNodeRouteStore(await packs(['34']));
    expect(await store.installed()).toEqual([]);
  });
});
