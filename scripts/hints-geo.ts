import { DatabaseSync } from 'node:sqlite';
import { decodeLines } from '../src/core/region/geom';
import { nameKey } from '../src/core/text/fold';

export type Part = { key: string; district: string; points: [number, number][] };

export function partsOf(db: DatabaseSync): Map<string, Part[]> {
  const rows = db.prepare('SELECT n.key key, d.name district, p.geom geom FROM street_part p JOIN street_name n ON n.id = p.name_id JOIN district d ON d.id = p.district_id').all() as { key: string; district: string; geom: Uint8Array }[];
  const out = new Map<string, Part[]>();
  for (const r of rows) {
    let points: [number, number][];
    try {
      points = decodeLines(r.geom).flat() as unknown as [number, number][];
    } catch {
      continue;
    }
    const k = `${nameKey(r.district)}|${r.key}`;
    const list = out.get(k) ?? [];
    list.push({ key: r.key, district: r.district, points });
    out.set(k, list);
  }
  return out;
}

export function knownStreets(db: DatabaseSync): { byDistrict: Set<string>; byHood: Set<string> } {
  const rows = db.prepare('SELECT DISTINCT d.name district, p.hood_id hood, n.key key FROM street_part p JOIN street_name n ON n.id = p.name_id JOIN district d ON d.id = p.district_id').all() as { district: string; hood: number | null; key: string }[];
  const doors = db.prepare('SELECT DISTINCT d.name district, a.hood_id hood, n.key key FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id').all() as { district: string; hood: number | null; key: string }[];
  const byDistrict = new Set<string>();
  const byHood = new Set<string>();
  for (const r of [...rows, ...doors]) {
    byDistrict.add(`${nameKey(r.district)}|${r.key}`);
    if (r.hood !== null) byHood.add(`${r.hood}|${r.key}`);
  }
  return { byDistrict, byHood };
}

export function displayName(street: string): string {
  return street
    .split(' ')
    .map((w) => (w === w.toLocaleUpperCase('tr') && /\p{L}{2,}/u.test(w) && !/^[IVX]+\.?$/.test(w) ? w.toLocaleLowerCase('tr').replace(/^\p{L}/u, (c) => c.toLocaleUpperCase('tr')) : w))
    .join(' ');
}
