import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapToBuilding } from '../../pipeline/build/learned-snap';
import { prepare, writeBuildingPack, type Trace } from '../../pipeline/build/building-pack-v2';
import { openBuildings2 } from '../../src/core/address/buildings2';
import { distanceM } from '../../src/core/geo/distance';
import type { LngLat } from '../../src/core/geo/cells';
import { openSqlite } from '../../src/node/sqlite';

const box = (lon: number, lat: number): [number, number][] => [[lon - 0.00004, lat - 0.00003], [lon + 0.00004, lat - 0.00003], [lon + 0.00004, lat + 0.00003], [lon - 0.00004, lat + 0.00003]];
const eastOf = (p: LngLat, m: number): LngLat => [p[0] + m / (111_195 * Math.cos((p[1] * Math.PI) / 180)), p[1]];

describe('snapToBuilding', () => {
  async function snap() {
    const trace: Trace = { id: 'b', lon: 28.6, lat: 40.7, area: 120, ring: box(28.6, 40.7), height: null, floors: null, name: null, cls: null, src: null, rec: null };
    const file = join(mkdtempSync(join(tmpdir(), 'snap-')), 'b.sqlite');
    writeBuildingPack(file, '34', prepare([trace], [], new Map()), new Map(), 't');
    const db = openSqlite(file);
    const reader = await openBuildings2(db);
    return { snap: snapToBuilding(reader), reader, db };
  }

  it('moves a point just outside a building to just inside it', async () => {
    const { snap: run, reader, db } = await snap();
    const outside = eastOf([28.6, 40.7], 6 + 4);
    const moved = await run(outside);
    expect(await reader.at(moved, 0)).not.toBeNull();
    expect(distanceM(moved, outside)).toBeLessThan(10);
    await db.close();
  });

  it('keeps a point that is already inside or far from any building', async () => {
    const { snap: run, db } = await snap();
    expect(await run([28.6, 40.7])).toEqual([28.6, 40.7]);
    const far = eastOf([28.6, 40.7], 200);
    expect(await run(far)).toEqual(far);
    await db.close();
  });
});
