import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import type { SqlDb } from '../src/core/ports';
import { rngOf, type GoldenQuery } from './build-address-golden';
import { PRIORITY, codeOf, goldenOf, openGolden } from './measure-address';

export type OracleItem = {
  id: string;
  plate: string;
  text: string;
  truth: LngLat;
  sdk: { status: string; precision: Place['precision'] | null; approximate: boolean | null; coordinate: LngLat | null };
};

const PER_PROVINCE = 40;
const SEED = 2026;
const KINDS = ['full', 'folded', 'hard'];

export function oracleSample(queries: GoldenQuery[], count: number, seed: number): GoldenQuery[] {
  const pool = queries.filter((q) => KINDS.includes(q.category) && !q.conflict);
  const next = rngOf(seed);
  const order = [...pool];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j] as GoldenQuery, order[i] as GoldenQuery];
  }
  return order.slice(0, count);
}

async function run(out: string): Promise<void> {
  const { store, search } = await openGolden();
  const items: OracleItem[] = [];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    for (const q of oracleSample(goldenOf(plate), PER_PROVINCE, SEED + Number(plate))) {
      const row = (await db.all<{ lon: number; lat: number }>('SELECT lon, lat FROM address WHERE osm = ? AND number = ? ORDER BY id LIMIT 1', [codeOf(q.expect.osm), q.expect.number as string]))[0];
      if (!row) continue;
      const result = await search.resolve(q.text);
      const first = result.status === 'region_missing' ? undefined : (result.status === 'resolved' ? result.best : result.candidates[0]);
      items.push({ id: q.id, plate, text: q.text, truth: [row.lon / 1e6, row.lat / 1e6], sdk: { status: result.status, precision: first?.precision ?? null, approximate: first?.approximate ?? null, coordinate: first?.coordinate ?? null } });
    }
    await db.close();
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(items));
  console.log(JSON.stringify({ written: out, items: items.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--out');
  const out = at >= 0 ? process.argv[at + 1] : undefined;
  if (!out) {
    console.error('kullanım: --out <dosya>');
    process.exit(2);
  }
  run(out).catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
