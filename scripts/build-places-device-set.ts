import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { BOX } from './build-building-device-set';
import { readDoors } from './addr-seq-eval';
import { addressPackOf } from './build-buildings-v2';
import { pick, repoRoot, seeded, seedOf, setsDir } from './addr-sets';

export type PlacesCase = { id: string; text: string; expected: { status: string; top: { coordinate: [number, number]; relation: string | null; radiusM: number | null; notes: string[] }[] } };

const RELATIONS = ['karşısı', 'yanı', 'arkası', 'köşesi'];
const CATEGORIES = ['eczane Kadıköy', 'hastane Kadıköy', 'cami Üsküdar', 'otel Beşiktaş', 'akaryakıt Kadıköy', 'banka Kadıköy', 'okul Üsküdar', 'market Kadıköy'];

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const addressFile = addressPackOf(plate);
  const buildingsFile = join(dir, `buildings2-${plate}.sqlite`);
  const address = openSqlite(addressFile);
  const buildings = openSqlite(buildingsFile);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) } as PackStore;
  const search = createSearch({ store, borders: createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))) });
  const raw = new DatabaseSync(addressFile, { readOnly: true });
  const names = new Map((raw.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const districts = new Map((raw.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const pois = raw.prepare('SELECT p.name name, d.name district FROM poi p JOIN district d ON d.id = p.district_id ORDER BY p.id').all() as { name: string; district: string }[];
  raw.close();
  const rng = seeded(seedOf(`places-device-${plate}`));
  const texts: { id: string; text: string }[] = [];
  const doors = readDoors(addressFile).filter((d) => d.lon >= BOX.west && d.lon <= BOX.east && d.lat >= BOX.south && d.lat <= BOX.north && d.suffix === '' && names.has(d.street));
  for (let i = 0; i < 24; i++) {
    const d = pick(rng, doors);
    texts.push({ id: `l${i}`, text: `${names.get(d.street)} ${d.num} ${RELATIONS[i % RELATIONS.length]} ${districts.get(d.district)} ${provinceName(plate)}` });
  }
  const counts = new Map<string, number>();
  for (const p of pois) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const unique = pois.filter((p) => counts.get(p.name) === 1 && p.name.length >= 5);
  for (let i = 0; i < 40; i++) {
    const p = pick(rng, unique);
    texts.push({ id: `p${i}`, text: i % 2 === 0 ? `${p.name} ${p.district}` : p.name });
  }
  for (const [i, text] of CATEGORIES.entries()) texts.push({ id: `c${i}`, text });
  const cases: PlacesCase[] = [];
  for (const t of texts) {
    const result = await search.resolve(t.text, { limit: 3 });
    const list = result.status === 'region_missing' ? [] : result.status === 'resolved' ? [result.best, ...result.candidates.filter((c) => c.id !== result.best.id)] : result.candidates;
    cases.push({ ...t, expected: { status: result.status, top: list.slice(0, 3).map((c) => ({ coordinate: c.coordinate, relation: c.relation?.kind ?? null, radiusM: c.radiusM ?? null, notes: c.notes ?? [] })) } });
  }
  await address.close();
  await buildings.close();
  writeFileSync(join(dir, `places-${plate}.json`), JSON.stringify(cases));
  const related = cases.filter((c) => c.expected.top.some((p) => p.relation !== null)).length;
  console.log(`${plate}: ${cases.length} vaka, ${related} tanesi yer işaretine göre bulundu`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
