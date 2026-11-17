import { readFileSync } from 'node:fs';
import { buildBuildingPack } from '../../pipeline/build/building-pack';
import { openSqlite } from '../../src/node/sqlite';
import { buildingFile, buildingSetup } from './helpers/building-fixture';

const FREE = [{ id: 'w100', lon: 28.6035, lat: 40.7001 }, { id: 'w101', lon: 28.6035, lat: 40.9 }];

const setup = (onCentres: boolean) => buildingSetup(onCentres, FREE);

describe('buildBuildingPack', () => {
  it('writes a part when the addresses sit on building centres, with the buildings near a street', async () => {
    const { work, pack, out } = await setup(true);
    const result = await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' });
    expect(result).toMatchObject({ written: true, buildings: 11 });
    expect(result.ratio).toBeGreaterThanOrEqual(0.5);
    const db = openSqlite(out);
    expect(await db.all('SELECT k, v FROM meta ORDER BY k')).toEqual([
      { k: 'buildings', v: '11' },
      { k: 'format', v: '1' },
      { k: 'osm_time', v: 't' },
      { k: 'province', v: '34' },
      { k: 'ratio', v: String(result.ratio) },
    ]);
    expect((await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM building_cell'))[0]?.n).toBe(5);
    await db.close();
  });

  it('writes nothing when the addresses are not on building centres', async () => {
    const { work, pack, out } = await setup(false);
    const result = await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' });
    expect(result).toMatchObject({ written: false, buildings: 0, bytes: 0 });
    expect(result.ratio).toBeLessThan(0.5);
    expect(() => readFileSync(out)).toThrow();
  });

  it('writes nothing when there are no buildings', async () => {
    const { work, pack, out } = await setup(true);
    buildingFile(work, '34', []);
    expect(await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' })).toMatchObject({ written: false, ratio: 0 });
  });

  it('gives the same bytes every time', async () => {
    const { work, pack, out } = await setup(true);
    await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' });
    const first = readFileSync(out);
    await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: 't' });
    expect(readFileSync(out).equals(first)).toBe(true);
  });

  it('removes an old part when the province no longer qualifies', async () => {
    const good = await setup(true);
    const out = good.out;
    await buildBuildingPack({ province: '34', workDir: good.work, addressFile: good.pack, outFile: out, osmTimestamp: 't' });
    const bad = await setup(false);
    await buildBuildingPack({ province: '34', workDir: bad.work, addressFile: bad.pack, outFile: out, osmTimestamp: 't' });
    expect(() => readFileSync(out)).toThrow();
  });
});
