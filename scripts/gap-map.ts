import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { repoRoot } from './addr-sets';

export type HoodGap = { plate: string; district: string; hood: string; sid: string | null; source: number; buildings: number; named: number; roadLinked: number; withNumber: number; doors: number; streets: number; unnamedRoads: number };
export type PlateGap = { plate: string; name: string; hoods: number; buildings: number; named: number; roadLinked: number; unlinked: number; doors: number; streets: number; unnamedRoads: number; bare: number; bareBuildings: number };

export const BARE_MIN_BUILDINGS = 30;
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const reportDir = (): string => join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19');

export function hoodGaps(plate: string, root = packs): HoodGap[] {
  const addressFile = join(root, plate, 'address.sqlite');
  const buildingFile = join(root, plate, 'buildings2.sqlite');
  if (!existsSync(addressFile) || !existsSync(buildingFile)) return [];
  const address = new DatabaseSync(addressFile, { readOnly: true });
  const buildings = new DatabaseSync(buildingFile, { readOnly: true });
  try {
    const hoods = address.prepare('SELECT h.id id, h.name name, h.sid sid, h.source source, d.name district FROM neighbourhood h JOIN district d ON d.id = h.district_id').all() as { id: number; name: string; sid: string | null; source: number; district: string }[];
    const doors = new Map((address.prepare('SELECT hood_id id, COUNT(*) n FROM address WHERE hood_id IS NOT NULL GROUP BY hood_id').all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
    const streets = new Map((address.prepare('SELECT hood_id id, COUNT(DISTINCT name_id) n FROM street_part WHERE hood_id IS NOT NULL AND src = 0 GROUP BY hood_id').all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
    const counts = new Map((buildings.prepare('SELECT hood id, COUNT(*) n, SUM(chain IS NOT NULL) named, SUM(chain IS NULL AND road IS NOT NULL) road, SUM(num IS NOT NULL OR pnum IS NOT NULL) numbered FROM building WHERE hood IS NOT NULL GROUP BY hood').all() as { id: number; n: number; named: number; road: number; numbered: number }[]).map((r) => [r.id, r]));
    const roads = new Map((buildings.prepare('SELECT hood id, COUNT(*) n FROM road WHERE hood IS NOT NULL GROUP BY hood').all() as { id: number; n: number }[]).map((r) => [r.id, r.n]));
    return hoods.map((h) => {
      const c = counts.get(h.id);
      return { plate, district: h.district, hood: h.name, sid: h.sid, source: h.source, buildings: c?.n ?? 0, named: c?.named ?? 0, roadLinked: c?.road ?? 0, withNumber: c?.numbered ?? 0, doors: doors.get(h.id) ?? 0, streets: streets.get(h.id) ?? 0, unnamedRoads: roads.get(h.id) ?? 0 };
    });
  } finally {
    address.close();
    buildings.close();
  }
}

export const isBare = (h: HoodGap): boolean => h.buildings >= BARE_MIN_BUILDINGS && h.streets === 0 && h.named === 0;

export function summarize(plate: string, hoods: HoodGap[]): PlateGap {
  const sum = (f: (h: HoodGap) => number): number => hoods.reduce((s, h) => s + f(h), 0);
  const bare = hoods.filter(isBare);
  const buildings = sum((h) => h.buildings);
  const named = sum((h) => h.named);
  const roadLinked = sum((h) => h.roadLinked);
  return { plate, name: provinceName(plate) ?? plate, hoods: hoods.length, buildings, named, roadLinked, unlinked: buildings - named - roadLinked, doors: sum((h) => h.doors), streets: sum((h) => h.streets), unnamedRoads: sum((h) => h.unnamedRoads), bare: bare.length, bareBuildings: bare.reduce((s, h) => s + h.buildings, 0) };
}

const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((100 * a) / b).toFixed(1)}`);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plates = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const all: HoodGap[] = [];
  const rows: PlateGap[] = [];
  for (const plate of plates) {
    const hoods = hoodGaps(plate);
    all.push(...hoods);
    rows.push(summarize(plate, hoods));
  }
  mkdirSync(reportDir(), { recursive: true });
  writeFileSync(join(reportDir(), 'bosluk-haritasi.json'), JSON.stringify({ at: new Date().toISOString(), rows, hoods: all }));
  const total = summarize('00', all);
  const bare = all.filter(isBare).sort((a, b) => b.buildings - a.buildings);
  console.log(JSON.stringify({ total, bareTop: bare.slice(0, 5), rows: rows.length, pctNamed: pct(total.named, total.buildings) }));
}
