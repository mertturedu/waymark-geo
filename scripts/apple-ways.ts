import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { oursOf, type AppleQuery, type Ours } from './apple-queries';
import { knownStreets } from './hints-geo';
import { groupsOf } from './hints-overture';

export const WAYS_PER_PLATE = Number(process.env.APPLE_WAYS ?? 25);
export const DOORS_PER_WAY = 5;
export const MIN_DISTINCT = 6;
export const MAX_NUMBER = 600;
export const MAX_HINT_RADIUS_M = 500;
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const waysQueriesDir = join(repoRoot, 'dist', 'apple', 'queries-ways');

export type WayCandidate = { district: string; street: string; numbers: number[]; pois: number };

export function pickNumbers(numbers: readonly number[], count = DOORS_PER_WAY): number[] {
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  if (distinct.length <= count) return distinct;
  return [...new Set(Array.from({ length: count }, (_, i) => distinct[Math.round((i * (distinct.length - 1)) / (count - 1))] as number))];
}

export function wayCandidates(plate: string): WayCandidate[] {
  const dir = join(packs, plate);
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const known = knownStreets(addr);
    const learned = new DatabaseSync(join(dir, 'learned.sqlite'), { readOnly: true });
    const compact = new Set<string>();
    try {
      for (const h of learned.prepare('SELECT district, name FROM hint WHERE radius <= ? AND NOT EXISTS (SELECT 1 FROM way WHERE way.district = hint.district AND way.name = hint.name)').all(MAX_HINT_RADIUS_M) as { district: string; name: string }[]) compact.add(`${h.district}|${streetKey(h.name).key}`);
    } finally {
      learned.close();
    }
    const numbers = new Map<string, number[]>();
    for (const r of directory.prepare('SELECT d.name district, t.text street, i.number number FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL AND i.conf >= 50').all() as { district: string; street: string; number: string }[]) {
      const m = /^(\d{1,4})$/.exec(r.number.trim());
      if (!m) continue;
      const key = `${nameKey(r.district)}|${streetKey(r.street).key}`;
      numbers.set(key, [...(numbers.get(key) ?? []), Number(m[1])]);
    }
    const out: WayCandidate[] = [];
    for (const [id, g] of groupsOf(directory)) {
      if (known.byDistrict.has(id) || !compact.has(id)) continue;
      const list = numbers.get(id) ?? [];
      if (new Set(list).size < MIN_DISTINCT || Math.max(...list) > MAX_NUMBER) continue;
      const name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      if (name.length < 5) continue;
      const district = (directory.prepare('SELECT name FROM district').all() as { name: string }[]).map((d) => d.name).find((n) => nameKey(n) === g.district) ?? g.district;
      out.push({ district, street: name, numbers: list, pois: g.pois.length });
    }
    return out.sort((a, b) => b.pois - a.pois || (a.street < b.street ? -1 : 1));
  } finally {
    addr.close();
    directory.close();
  }
}

export async function wayQueriesOf(plate: string): Promise<AppleQuery[]> {
  const province = provinceName(plate) ?? plate;
  const drafts: { street: string; district: string; number: number; streetIndex: number }[] = [];
  wayCandidates(plate).slice(0, WAYS_PER_PLATE).forEach((c, streetIndex) => {
    for (const n of pickNumbers(c.numbers)) drafts.push({ street: c.street, district: c.district, number: n, streetIndex });
  });
  const texts = drafts.map((d) => `${d.street} No:${d.number} ${d.district} ${province}`);
  const ours: Ours[] = await oursOf(plate, texts);
  return drafts.map((d, i): AppleQuery => ({ id: `w-${plate}-${String(d.streetIndex).padStart(3, '0')}-${String(i).padStart(4, '0')}`, plate, set: 'yol', text: texts[i]!, district: d.district, center: null, hood: null, street: d.street, number: String(d.number), truth: null, ours: ours[i] as Ours }));
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  mkdirSync(waysQueriesDir, { recursive: true });
  let total = 0;
  for (const plate of plates) {
    if (!['address', 'directory', 'learned'].every((n) => existsSync(join(packs, plate, `${n}.sqlite`)))) continue;
    const list = await wayQueriesOf(plate);
    if (list.length > 0) writeFileSync(join(waysQueriesDir, `${plate}.jsonl`), list.map((q) => JSON.stringify(q)).join('\n') + '\n');
    total += list.length;
    console.log(JSON.stringify({ plate, n: list.length }));
  }
  console.log(JSON.stringify({ total }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
