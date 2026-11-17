import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { packsDir, pick, plates, readDoors, seedOf, seeded, updateManifest, writeSet, type Door } from './addr-sets';

const PLACES_PER_PLATE = 500;
const REVERSE_PER_PLATE = 500;

export type PlaceRecord = { id: string; plate: string; poi: number; name: string; district: string; province: string; lng: number; lat: number; text: string; form: string; near: [number, number] | null };
export type ReverseRecord = Door;

const FORMS = ['{name}', '{name} {district}', '{name} {district} {province}', '{name}, {district}'];

export function placeRecords(plate: string): PlaceRecord[] {
  const dir = join(packsDir(), plate);
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.startsWith('directory-') && f.endsWith('.sqlite')) : undefined;
  if (!file) return [];
  const db = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    const rows = db.prepare('SELECT p.id id, p.name name, p.lon lon, p.lat lat, d.name district FROM poi p JOIN district d ON d.id = p.district_id ORDER BY p.id').all() as { id: number; name: string; lon: number; lat: number; district: string }[];
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    const unique = rows.filter((r) => counts.get(r.name) === 1 && r.name.length >= 4);
    const rng = seeded(seedOf(`${plate}-places`));
    const province = provinceName(plate) ?? plate;
    const out: PlaceRecord[] = [];
    const used = new Set<number>();
    while (out.length < Math.min(PLACES_PER_PLATE, unique.length)) {
      const r = pick(rng, unique);
      if (used.has(r.id)) continue;
      used.add(r.id);
      const form = pick(rng, FORMS);
      const bearing = rng() * 2 * Math.PI;
      const away = 500 + rng() * 3500;
      const near: [number, number] | null = form === '{name}' ? [r.lon / 1e6 + (Math.cos(bearing) * away) / (111_320 * Math.cos((r.lat / 1e6 * Math.PI) / 180)), r.lat / 1e6 + (Math.sin(bearing) * away) / 111_320] : null;
      out.push({ id: `${plate}:p:${r.id}`, plate, poi: r.id, name: r.name, district: r.district, province, lng: r.lon / 1e6, lat: r.lat / 1e6, form, near, text: form.replace('{name}', r.name).replace('{district}', r.district).replace('{province}', province) });
    }
    return out;
  } finally {
    db.close();
  }
}

export function reverseRecords(plate: string): ReverseRecord[] {
  const osm = new Set(readDoors(plate, 'osm').map((d) => `${d.district}|${d.street}|${d.number}`));
  const business = readDoors(plate, 'business').filter((d) => !osm.has(`${d.district}|${d.street}|${d.number}`));
  const rng = seeded(seedOf(`${plate}-reverse`));
  const copy = [...business];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as Door, copy[i] as Door];
  }
  return copy.slice(0, REVERSE_PER_PLATE);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wanted = process.argv.includes('--plates') ? (process.argv[process.argv.indexOf('--plates') + 1] ?? '').split(',') : plates();
  const g7: { [plate: string]: string } = {};
  const g8: { [plate: string]: string } = {};
  for (const plate of wanted) {
    const places = placeRecords(plate);
    const reverse = reverseRecords(plate);
    g7[plate] = writeSet('g7', plate, places);
    g8[plate] = writeSet('g8', plate, reverse);
    console.log(`${plate}: yer ${places.length}, ters ${reverse.length}`);
  }
  updateManifest('g7', g7, { perPlate: PLACES_PER_PLATE, forms: FORMS });
  updateManifest('g8', g8, { perPlate: REVERSE_PER_PLATE, source: 'OSM\'de olmayan işletme kapıları; ters arama rehber paketi kapalıyken' });
}
