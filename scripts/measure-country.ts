import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSearch } from '../src/core/address/search';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { openSqlite } from '../src/node/sqlite';
import { evalText } from './addr-eval';
import { COUNTRY_DIR } from './build-country-base';
import { readSet, repoRoot, type TextRecord } from './addr-sets';

type Measured = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

const PLATES = ['16', '41', '06', '35'];
const PER_PLATE = 400;
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((a / b) * 100).toFixed(1)}`);

async function streetCheck(plates: string[]): Promise<Measured> {
  let total = 0;
  let street = 0;
  let district = 0;
  let found = 0;
  let close = 0;
  for (const plate of plates) {
    const file = join(COUNTRY_DIR, plate, 'address.sqlite');
    const db = openSqlite(file);
    const store: PackStore = { installed: async () => [plate], open: async () => db, openPart: async () => null };
    const search = createSearch({ store, borders });
    const records = readSet<TextRecord>('g2', plate).filter((r) => r.source === 'osm').slice(0, PER_PLATE);
    for (const record of records) {
      const outcome = await evalText(search, record);
      total += 1;
      if (outcome.status !== 'not_found') found += 1;
      if (outcome.streetOk) street += 1;
      if (outcome.districtOk) district += 1;
      if (outcome.streetOk && outcome.errorM <= 500) close += 1;
    }
    await db.close();
  }
  return { check: 'street', pass: total > 0 && street / total >= 0.8, numbers: { street: street / Math.max(1, total), total }, measured: `${plates.length} il, ${total} G2 metni, yalnız sokak dizini (kapı ve işletme yok): sonuç bulunan ${pct(found, total)}, sokak doğru ${pct(street, total)}, ilçe doğru ${pct(district, total)}, sokak doğru ve nokta ≤ 500 m ${pct(close, total)}` };
}

const check = process.argv.find((a) => a.startsWith('--check='))?.slice(8) ?? 'street';
const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
void (async () => {
  if (check === 'street') console.log(JSON.stringify(await streetCheck(arg ? arg.split(',') : PLATES)));
})();
