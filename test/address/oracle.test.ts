import { join } from 'node:path';
import { openRegion, type Region } from '../../src/core/address/pack';
import { reverseDetailed } from '../../src/core/address/reverse';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { openSqlite } from '../../src/node/sqlite';
import { searchRows, turkeyBorders } from './helpers/search-fixture';
import { writeWork } from '../pipeline/helpers/mini-work';
import { reverseOracle } from './oracle';

let region: Region;
let close: () => Promise<void>;

beforeAll(async () => {
  const dir = writeWork(searchRows());
  const file = join(dir, '34.sqlite');
  await buildAddressPack({ province: '34', workDir: dir, outFile: file, osmTimestamp: 't' });
  const db = openSqlite(file);
  close = () => db.close();
  region = await openRegion(db);
});

afterAll(async () => close());

describe('reverse oracle', () => {
  const borders = turkeyBorders();

  it('gives the ids of the door, the street, the area or nothing', async () => {
    expect(await reverseOracle([region], borders, [28.59995, 40.7])).toMatchObject({ plate: '34', addressId: expect.any(Number), streetId: expect.any(Number) });
    expect(await reverseOracle([region], borders, [28.6525, 40.7205])).toMatchObject({ plate: '34', addressId: null, streetId: expect.any(Number) });
    expect(await reverseOracle([region], borders, [28.55, 40.55])).toMatchObject({ addressId: null, streetId: null, hoodId: expect.any(Number) });
    expect(await reverseOracle([region], borders, [35, 39])).toBeNull();
  });

  it('agrees with the indexed lookup on a grid of points around the fixture', async () => {
    let compared = 0;
    for (let lon = 28.58; lon <= 28.7; lon += 0.0017) {
      for (let lat = 40.59; lat <= 40.78; lat += 0.0013) {
        const point: [number, number] = [lon, lat];
        const found = await reverseDetailed([region], borders, point);
        const slow = await reverseOracle([region], borders, point);
        expect(found ? { plate: found.plate, districtId: found.districtId, hoodId: found.hoodId, addressId: found.addressId, streetId: found.streetId } : null).toEqual(slow);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  });
});
