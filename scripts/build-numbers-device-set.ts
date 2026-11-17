import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { repoRoot, setsDir } from './addr-sets';

export const NUMBERS_PLATE = process.env.NUMBERS_PLATE ?? '67';
export const PER_KIND = { known: 20, predicted: 30, none: 10 };
export const RANGE_CHAINS = 20;

export type NumbersCase = { id: string; point: [number, number]; kind: string; expected: string };
export type NumbersSet = { buildings: NumbersCase[]; ranges: { chain: number; expected: string }[] };

export async function numbersSet(file: string): Promise<NumbersSet> {
  const db = openSqlite(file);
  const reader = await openBuildings2(db);
  const rand = rng(6969);
  const rows = await db.all<{ id: number; lon: number; lat: number; num: string | null; pnum: number | null; chain: number | null }>('SELECT id, lon, lat, num, pnum, chain FROM building WHERE chain IS NOT NULL ORDER BY id');
  const kinds: [string, typeof rows][] = [
    ['known', rows.filter((r) => r.num !== null)],
    ['predicted', rows.filter((r) => r.num === null && r.pnum !== null)],
    ['none', rows.filter((r) => r.num === null && r.pnum === null)],
  ];
  const buildings: NumbersCase[] = [];
  for (const [kind, list] of kinds) {
    for (const [i, r] of shuffle(list, rand).slice(0, PER_KIND[kind as keyof typeof PER_KIND]).entries()) {
      const point: [number, number] = [r.lon / 1e6, r.lat / 1e6];
      const b = await reader.at(point, 3);
      buildings.push({ id: `${kind}-${i}`, point, kind, expected: JSON.stringify({ id: b?.id ?? null, known: b?.knownNumber ?? null, source: b?.knownSource ?? null, predicted: b?.predictedNumber ?? null }) });
    }
  }
  const chains = await db.all<{ chain: number }>('SELECT DISTINCT chain FROM street_range ORDER BY chain');
  const ranges: NumbersSet['ranges'] = [];
  for (const { chain } of shuffle(chains, rand).slice(0, RANGE_CHAINS)) ranges.push({ chain, expected: JSON.stringify(await reader.ranges(chain)) });
  await db.close();
  return { buildings, ranges };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `numbers-${NUMBERS_PLATE}-buildings2.sqlite`);
  copyFileSync(join(repoRoot, 'dist', 'work', '261028', 'packs', NUMBERS_PLATE, 'buildings2.sqlite'), file);
  numbersSet(file).then((set) => {
    writeFileSync(join(dir, 'numbers.json'), JSON.stringify({ plate: NUMBERS_PLATE, ...set }));
    const by: Record<string, number> = {};
    for (const c of set.buildings) by[c.kind] = (by[c.kind] ?? 0) + 1;
    console.log(JSON.stringify({ buildings: by, ranges: set.ranges.length }));
  });
}
