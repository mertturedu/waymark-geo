import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch } from './addr-eval';
import { packsDir, pick, seeded } from './addr-sets';

type Row = { street: string; number: string; district: string; postcode: string; lng: number; lat: number };

function rowsOf(plate: string): Row[] {
  const dir = join(packsDir(), plate);
  const file = readdirSync(dir).find((f) => f.startsWith('address-') && f.endsWith('.sqlite'));
  if (!file) return [];
  const db = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    return (
      db
        .prepare(
          `SELECT s.name street, a.number number, d.name district, a.postcode postcode, a.lon lon, a.lat lat
           FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id
           WHERE a.postcode IS NOT NULL AND a.num IS NOT NULL AND a.hood_id IS NOT NULL`,
        )
        .all() as { street: string; number: string; district: string; postcode: string; lon: number; lat: number }[]
    ).map((r) => ({ street: r.street, number: r.number, district: r.district, postcode: r.postcode, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
  } finally {
    db.close();
  }
}

export type PostcodeResult = { count: number; withCode: number; withoutCode: number };

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,06,16').split(',');
  const count = Number(process.argv[3] ?? 300);
  const search = await openSearch();
  let withCode = 0;
  let withoutCode = 0;
  let total = 0;
  for (const plate of plates) {
    const rng = seeded(77);
    const rows = rowsOf(plate);
    for (let i = 0; i < Math.min(count, rows.length); i++) {
      const r = pick(rng, rows);
      const base = `${r.street} ${r.number}`;
      const a = await search.resolve(`${base} ${r.postcode}`);
      const b = await search.resolve(base);
      const point = (res: typeof a): [number, number] | null => (res.status === 'resolved' ? res.best.coordinate : res.status === 'ambiguous' ? res.candidates[0]?.coordinate ?? null : null);
      const pa = point(a);
      const pb = point(b);
      if (pa && distanceM(pa, [r.lng, r.lat]) <= 30) withCode++;
      if (pb && distanceM(pb, [r.lng, r.lat]) <= 30) withoutCode++;
      total++;
    }
    search.invalidate(plate);
  }
  const result: PostcodeResult = { count: total, withCode: Number(((100 * withCode) / total).toFixed(1)), withoutCode: Number(((100 * withoutCode) / total).toFixed(1)) };
  console.log(`posta kodu yazılınca ≤30 m %${result.withCode}, yazılmayınca %${result.withoutCode} (${total} kapı; yalnız sokak ve numara)`);
  recordMeasure('a3_postcode', result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
