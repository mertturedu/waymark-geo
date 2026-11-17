import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import { createTypeSession } from '../src/core/address/typeahead';
import { createBorders } from '../src/core/region/borders';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { addressPackOf } from './build-buildings-v2';
import { readSet, repoRoot, setsDir, type TextRecord } from './addr-sets';

export type TypeCase = { id: string; text: string; expected: string[] };

const PLATE = '34';
const COUNT = 100;

async function main(): Promise<void> {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const address = openSqlite(addressPackOf(PLATE));
  const store: PackStore = { installed: async () => [PLATE], open: async () => address } as PackStore;
  const search = createSearch({ store, borders: createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))) });
  const records = readSet<TextRecord>('g1s', PLATE).filter((_, i) => i % 9 === 0).slice(0, COUNT);
  const cases: TypeCase[] = [];
  let keys = 0;
  for (const r of records) {
    const session = createTypeSession();
    const expected: string[] = [];
    for (let k = 1; k <= r.text.length; k++) {
      const list = await search.autocomplete(r.text.slice(0, k), { limit: 3, session });
      expected.push(list.map((p) => p.id).join('|'));
      keys++;
    }
    cases.push({ id: r.id, text: r.text, expected });
  }
  await address.close();
  writeFileSync(join(dir, `typeahead-${PLATE}.json`), JSON.stringify(cases));
  console.log(`${cases.length} metin, ${keys} tuş`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
