import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { createSearch } from '../src/core/address/search';
import type { PackStore } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { setsDir } from './addr-sets';

export const SHAPE_STREETS = 40;
export const SHAPE_AREAS = 20;
const PLATE = '34';

export type ShapeExpected = { status: string; top: string };
export type ShapeCase = { id: string; text: string; expected: ShapeExpected };

export async function shapeCases(addressFile: string): Promise<ShapeCase[]> {
  const address = openSqlite(addressFile);
  const region = await openRegion(address);
  const store: PackStore = { installed: async () => [PLATE], open: async () => address, openPart: async () => null };
  const search = createSearch({ store, borders: embeddedBorders() });
  const rand = rng(4141);
  const streets = await address.all<{ name: string; district: string }>('SELECT s.name AS name, d.name AS district FROM street_name s JOIN street_part p ON p.name_id = s.id JOIN district d ON d.id = p.district_id GROUP BY s.id, p.district_id ORDER BY s.id');
  const texts: { id: string; text: string }[] = [
    ...shuffle(streets, rand).slice(0, SHAPE_STREETS).map((s, i) => ({ id: `street-${i}`, text: `${s.name} ${s.district} İstanbul` })),
    ...shuffle(region.hoods, rand).slice(0, SHAPE_AREAS - 5).map((h, i) => ({ id: `hood-${i}`, text: `${h.name} Mahallesi ${region.districts.find((d) => d.id === h.districtId)?.name ?? ''}` })),
    ...shuffle(region.districts, rand).slice(0, 5).map((d, i) => ({ id: `district-${i}`, text: `${d.name} İstanbul` })),
  ];
  const out: ShapeCase[] = [];
  for (const item of texts) {
    const result = await search.resolve(item.text, { geometry: true, limit: 5 });
    const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
    out.push({ id: item.id, text: item.text, expected: { status: result.status, top: JSON.stringify(top.map((p) => ({ id: p.id, bbox: p.bbox ?? null, geometry: p.geometry ?? null }))) } });
  }
  await address.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  shapeCases(join(dir, `reverse-${PLATE}-address.sqlite`)).then((cases) => {
    writeFileSync(join(dir, 'shapes.json'), JSON.stringify(cases));
    console.log(JSON.stringify({ cases: cases.length, withShape: cases.filter((c) => c.expected.top.includes('"geometry":{')).length, bytes: JSON.stringify(cases).length }));
  });
}
