import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { adminLookupSet } from './country-set';
import { createSearch } from '../src/core/address/search';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { COUNTRY_DIR } from './build-country-base';
import { readSet, repoRoot, setsDir, type TextRecord } from './addr-sets';

export const COUNTRY_PLATE = '16';
export const QUERIES = 80;
export const LOOKUPS = 30;

export type CountryCase = { id: string; text: string; expected: string };
export type CountrySet = { plate: string; queries: CountryCase[]; lookups: { sid: string; expected: string }[]; admin: { query: Record<string, string>; expected: string }[] };

export async function countrySet(file: string, plate = COUNTRY_PLATE): Promise<CountrySet> {
  const db = openSqlite(file);
  const store: PackStore = { installed: async () => [plate], open: async () => db, openPart: async () => null };
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const search = createSearch({ store, borders });
  const rand = rng(1616);
  const queries: CountryCase[] = [];
  for (const [i, r] of shuffle(readSet<TextRecord>('g2', plate).filter((x) => x.source === 'osm'), rand).slice(0, QUERIES).entries()) {
    const result = await search.resolve(r.text, { limit: 5 });
    const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
    queries.push({ id: `q${i}`, text: r.text, expected: JSON.stringify({ status: result.status, top: top.map((p) => ({ id: p.id, sid: p.sid ?? null, point: p.coordinate, precision: p.precision })) }) });
  }
  const set = await adminLookupSet(search, plate, LOOKUPS);
  await db.close();
  return { plate, queries, ...set };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `country-${COUNTRY_PLATE}-address.sqlite`);
  copyFileSync(join(COUNTRY_DIR, COUNTRY_PLATE, 'address.sqlite'), file);
  countrySet(file).then((set) => {
    writeFileSync(join(dir, 'country.json'), JSON.stringify(set));
    console.log(JSON.stringify({ queries: set.queries.length, lookups: set.lookups.length, admin: set.admin.length }));
  });
}
