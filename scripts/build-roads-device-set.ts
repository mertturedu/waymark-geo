import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { repoRoot, setsDir } from './addr-sets';

export const ROADS_PLATE = '67';
export const PER_KIND = { named: 25, road: 35, none: 10 };

export type RoadsCase = { id: string; point: [number, number]; kind: string; expected: string };

export async function roadsCases(file: string): Promise<RoadsCase[]> {
  const db = openSqlite(file);
  const reader = await openBuildings2(db);
  const rand = rng(6868);
  const rows = await db.all<{ id: number; lon: number; lat: number; chain: number | null; road: number | null }>('SELECT id, lon, lat, chain, road FROM building ORDER BY id');
  const kinds: [string, typeof rows][] = [
    ['named', rows.filter((r) => r.chain !== null)],
    ['road', rows.filter((r) => r.chain === null && r.road !== null)],
    ['none', rows.filter((r) => r.chain === null && r.road === null)],
  ];
  const out: RoadsCase[] = [];
  for (const [kind, list] of kinds) {
    for (const [i, r] of shuffle(list, rand).slice(0, PER_KIND[kind as keyof typeof PER_KIND]).entries()) {
      const point: [number, number] = [r.lon / 1e6, r.lat / 1e6];
      const b = await reader.at(point, 3);
      const road = b?.road === undefined ? null : await reader.road(b.road);
      out.push({ id: `${kind}-${i}`, point, kind, expected: JSON.stringify({ id: b?.id ?? null, chain: b?.chain ?? null, hood: b?.hood ?? null, road: b?.road ?? null, dist: b?.roadDistanceM ?? null, line: road ? road.line : null, roadHood: road?.hood ?? null }) });
    }
  }
  await db.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `roads-${ROADS_PLATE}-buildings2.sqlite`);
  copyFileSync(join(repoRoot, 'dist', 'work', '261028', 'packs', ROADS_PLATE, 'buildings2.sqlite'), file);
  roadsCases(file).then((cases) => {
    writeFileSync(join(dir, 'roads.json'), JSON.stringify(cases));
    const withRoad = cases.filter((c) => c.kind === 'road' && JSON.parse(c.expected).line).length;
    console.log(JSON.stringify({ cases: cases.length, roadLinesFound: withRoad }));
  });
}
