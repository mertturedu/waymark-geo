import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { provinceName } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { rng } from '../test/sim/random';
import { repoRoot } from './addr-sets';
import { oursOf, roundRobin, type AppleQuery, type Ours } from './apple-queries';

export const DOORS_PER_PLATE = Number(process.env.APPLE_DOORS ?? 100);
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const doorQueriesDir = join(repoRoot, 'dist', 'apple', 'queries-doors');

type Poi = { street: string; district: string; number: string; point: LngLat };

export function missingDoors(plate: string): Poi[] {
  const dir = join(packs, plate);
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const known = new Set<string>();
    for (const r of addr.prepare('SELECT DISTINCT d.name district, n.key key FROM street_part p JOIN street_name n ON n.id = p.name_id JOIN district d ON d.id = p.district_id').all() as { district: string; key: string }[]) known.add(`${nameKey(r.district)}|${r.key}`);
    const have = new Set<string>();
    for (const r of addr.prepare('SELECT d.name district, n.key key, a.num num FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id WHERE a.num IS NOT NULL').all() as { district: string; key: string; num: number }[]) have.add(`${nameKey(r.district)}|${r.key}|${r.num}`);
    const out: Poi[] = [];
    const seen = new Set<string>();
    for (const r of directory.prepare('SELECT d.name district, t.text street, i.number number, p.lon lon, p.lat lat FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL AND i.conf >= 70').all() as { district: string; street: string; number: string; lon: number; lat: number }[]) {
      const m = /^(\d{1,4})$/.exec(r.number.trim());
      if (!m) continue;
      const key = `${nameKey(r.district)}|${streetKey(r.street).key}`;
      if (!known.has(key) || have.has(`${key}|${m[1]}`) || seen.has(`${key}|${m[1]}`)) continue;
      seen.add(`${key}|${m[1]}`);
      out.push({ street: r.street, district: r.district, number: m[1]!, point: [r.lon / 1e6, r.lat / 1e6] });
    }
    return out;
  } finally {
    addr.close();
    directory.close();
  }
}

export function pickDoors(pois: readonly Poi[], count: number, seed: number): Poi[] {
  const groups = new Map<string, Poi[]>();
  for (const p of pois) groups.set(p.district, [...(groups.get(p.district) ?? []), p]);
  const streets = new Map<string, number>();
  return roundRobin(groups, count, rng(seed), (p) => (streets.get(`${p.district}|${p.street}`) ?? 0) < 2).map((p) => {
    streets.set(`${p.district}|${p.street}`, (streets.get(`${p.district}|${p.street}`) ?? 0) + 1);
    return p;
  });
}

export async function doorQueriesOf(plate: string): Promise<AppleQuery[]> {
  const province = provinceName(plate) ?? plate;
  const picked = pickDoors(missingDoors(plate), DOORS_PER_PLATE, Number(plate) * 104729 + 20261115);
  const texts = picked.map((p) => `${p.street} No:${p.number} ${p.district} ${province}`);
  const ours: Ours[] = await oursOf(plate, texts);
  return picked.map((p, i): AppleQuery => ({ id: `d-${plate}-${String(i).padStart(3, '0')}`, plate, set: 'bosnum', text: texts[i]!, district: p.district, center: null, hood: null, street: p.street, number: p.number, truth: p.point, ours: ours[i] as Ours }));
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  mkdirSync(doorQueriesDir, { recursive: true });
  let total = 0;
  for (const plate of plates) {
    if (!['address', 'directory', 'learned'].every((n) => existsSync(join(packs, plate, `${n}.sqlite`)))) continue;
    const list = await doorQueriesOf(plate);
    writeFileSync(join(doorQueriesDir, `${plate}.jsonl`), list.map((q) => JSON.stringify(q)).join('\n') + '\n');
    total += list.length;
    console.log(JSON.stringify({ plate, n: list.length }));
  }
  console.log(JSON.stringify({ total }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
