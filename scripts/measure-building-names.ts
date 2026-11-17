import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { percentile } from './measure-quality';
import { repoRoot } from './addr-sets';

export const BUILDING_NAME = /(sitesi|apartman[ıi]?|apt\.?|evleri|konutlar[ıi]|rezidans|residence|plaza|iş merkezi|is merkezi)\b/i;
const INDUSTRIAL = /sanayi|organize|oto\b|galeri/i;
export const NEAR_M = 100;
export const MIN_SHARE = 95;

export type Row = { name: string; sname: string; district: string; number: string; lon: number; lat: number };
export type Stat = { plate: string; named: number; withDoor: number; matched: number; within: number; median: number; p90: number; osmNamed: number; osmAgree: number };

const numberKey = (n: string): string => n.toLowerCase().replace(/\s+/g, '').replace(/^no:?/, '');

export function buildingRows(dir: string): Row[] {
  const db = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare("SELECT p.name AS name, s.name AS sname, d.name AS district, i.number AS number, p.lon AS lon, p.lat AS lat FROM poi p JOIN poi_info i ON i.id = p.id JOIN street_name s ON s.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL AND i.number <> ''").all() as Row[];
    return rows.filter((r) => BUILDING_NAME.test(r.name) && !INDUSTRIAL.test(r.name)).map((r) => ({ ...r, lon: r.lon / 1e6, lat: r.lat / 1e6 }));
  } finally {
    db.close();
  }
}

export function measurePlate(plate: string): Stat {
  const dir = join(repoRoot, 'dist', 'work', '261028', 'packs', plate);
  const rows = buildingRows(dir);
  const address = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const doors = new Map<string, [number, number][]>();
  for (const r of address.prepare('SELECT a.nkey nkey, a.lon lon, a.lat lat, d.name district, s.name sname FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id').all() as { nkey: string; lon: number; lat: number; district: string; sname: string }[]) {
    const k = `${nameKey(r.district)}|${streetKey(r.sname).key}|${numberKey(r.nkey)}`;
    doors.set(k, [...(doors.get(k) ?? []), [r.lon / 1e6, r.lat / 1e6]]);
  }
  const buildings = new DatabaseSync(join(dir, 'buildings2.sqlite'), { readOnly: true });
  const osm = (buildings.prepare("SELECT name, lon, lat FROM building WHERE name IS NOT NULL AND name <> ''").all() as { name: string; lon: number; lat: number }[]).filter((b) => BUILDING_NAME.test(b.name)).map((b) => ({ key: nameKey(b.name), at: [b.lon / 1e6, b.lat / 1e6] as [number, number] }));
  const byName = new Map<string, [number, number][]>();
  for (const b of osm) byName.set(b.key, [...(byName.get(b.key) ?? []), b.at]);
  const gaps: number[] = [];
  let withDoor = 0;
  let osmAgree = 0;
  let osmNamed = 0;
  for (const r of rows) {
    const at: [number, number] = [r.lon, r.lat];
    const found = doors.get(`${nameKey(r.district)}|${streetKey(r.sname).key}|${numberKey(r.number)}`);
    if (found) {
      withDoor++;
      gaps.push(Math.min(...found.map((d) => distanceM(d, at))));
    }
    const same = byName.get(nameKey(r.name));
    if (same && same.every((b) => distanceM(b, same[0] as [number, number]) <= 300)) {
      osmNamed++;
      if (same.some((b) => distanceM(b, at) <= NEAR_M * 2)) osmAgree++;
    }
  }
  address.close();
  buildings.close();
  const sorted = [...gaps].sort((a, b) => a - b);
  return { plate, named: rows.length, withDoor, matched: gaps.length, within: gaps.filter((g) => g <= NEAR_M).length, median: gaps.length ? percentile(sorted, 50) : 0, p90: gaps.length ? percentile(sorted, 90) : 0, osmNamed, osmAgree };
}

async function main(): Promise<void> {
  const plates = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const list = plates.length ? plates : ['20', '42', '35', '34', '06', '16', '01', '07'];
  const stats = list.map(measurePlate);
  const sum = stats.reduce((m, s) => ({ named: m.named + s.named, matched: m.matched + s.matched, within: m.within + s.within, osmNamed: m.osmNamed + s.osmNamed, osmAgree: m.osmAgree + s.osmAgree }), { named: 0, matched: 0, within: 0, osmNamed: 0, osmAgree: 0 });
  const rate = (a: number, b: number): string => (b ? `%${((100 * a) / b).toFixed(1)}` : '-');
  const lines = stats.map((s) => `| ${s.plate} | ${s.named} | ${s.matched} | ${rate(s.within, s.matched)} | ${Math.round(s.median)} | ${Math.round(s.p90)} | ${s.osmNamed} | ${rate(s.osmAgree, s.osmNamed)} |`);
  const out = `\n| İl | Yapı adlı nokta (sokak+no) | OSM kapısıyla eşleşen | ≤ ${NEAR_M} m | Ortanca m | p90 m | OSM'de tek yerde duran aynı adlı bina | ≤ 200 m uyum |\n|---|---|---|---|---|---|---|---|\n${lines.join('\n')}\n| **Toplam** | ${sum.named} | ${sum.matched} | ${rate(sum.within, sum.matched)} | | | ${sum.osmNamed} | ${rate(sum.osmAgree, sum.osmNamed)} |\n`;
  mkdirSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19'), { recursive: true });
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'yapi-adlari-olcum.md'), out);
  console.log(out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
