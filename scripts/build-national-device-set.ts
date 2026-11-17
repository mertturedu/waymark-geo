import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { createSearch } from '../src/core/address/search';
import type { PackStore } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { provinceName } from '../src/core/text/admin';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { repoRoot, setsDir } from './addr-sets';

export const NATIONAL_PLATE = '67';
export const PER_SOURCE: Record<number, number> = { 0: 12, 3: 18, 4: 6, 5: 12, 6: 12 };

export type NationalCase = { id: string; text: string; source: number; expected: { status: string; top: string } };

export async function nationalCases(addressFile: string, plate = NATIONAL_PLATE): Promise<NationalCase[]> {
  const address = openSqlite(addressFile);
  const region = await openRegion(address);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async () => null };
  const search = createSearch({ store, borders: embeddedBorders() });
  const rand = rng(6767);
  const province = provinceName(plate) ?? plate;
  const out: NationalCase[] = [];
  for (const [source, count] of Object.entries(PER_SOURCE)) {
    const hoods = region.hoods.filter((h) => h.source === Number(source));
    for (const [i, h] of shuffle(hoods, rand).slice(0, count).entries()) {
      const district = region.districts.find((d) => d.id === h.districtId)?.name ?? '';
      const text = `${h.name} ${district} ${province}`;
      const result = await search.resolve(text, { geometry: true, limit: 5 });
      const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
      out.push({ id: `s${source}-${i}`, text, source: Number(source), expected: { status: result.status, top: JSON.stringify(top.map((p) => ({ id: p.id, name: p.label, point: p.coordinate, bbox: p.bbox ?? null, geometry: p.geometry ?? null }))) } });
    }
  }
  await address.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `national-${NATIONAL_PLATE}-address.sqlite`);
  copyFileSync(join(repoRoot, 'dist', 'work', '261028', 'packs', NATIONAL_PLATE, 'address.sqlite'), file);
  nationalCases(file).then((cases) => {
    writeFileSync(join(dir, 'national.json'), JSON.stringify(cases));
    const bySource: Record<string, [number, number]> = {};
    for (const c of cases) {
      const e = (bySource[c.source] ??= [0, 0]);
      e[0] += 1;
      if (c.expected.status !== 'unresolved' && c.expected.top !== '[]') e[1] += 1;
    }
    console.log(JSON.stringify({ cases: cases.length, bySourceFound: bySource }));
  });
}
