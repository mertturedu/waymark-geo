import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { provinceName } from '../src/core/text/admin';

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const DATA_VERSION = '20261028.20261030.3';
export const packsDir = (version = DATA_VERSION): string => join(repoRoot, 'dist', 'releases', version, 'packs');
export const setsDir = (version = DATA_VERSION): string => join(repoRoot, 'dist', 'addr-eval', version);

export type Rng = () => number;
export function seeded(seed: number): Rng {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)] as T;
export const seedOf = (text: string): number => createHash('sha256').update(text).digest().readUInt32LE(0);

export type Door = { id: string; plate: string; source: 'osm' | 'business'; lng: number; lat: number; province: string; district: string; hood: string | null; street: string; kind: string | null; number: string; num: number };

export type TextRecord = Door & { text: string; ops: string[]; unit?: { floor?: string; door?: string; block?: string } };

const fileOf = (plate: string, prefix: string): string | null => {
  const dir = join(packsDir(), plate);
  if (!existsSync(dir)) return null;
  const name = readdirSync(dir).find((f) => f.startsWith(`${prefix}-`) && f.endsWith('.sqlite'));
  return name ? join(dir, name) : null;
};

export function plates(): string[] {
  const manifest = JSON.parse(readFileSync(join(packsDir(), 'manifest-v1.json'), 'utf8')) as { regions: { id: string }[] };
  return manifest.regions.map((r) => r.id).sort();
}

export function readDoors(plate: string, source: 'osm' | 'business'): Door[] {
  const file = fileOf(plate, source === 'osm' ? 'address' : 'directory');
  if (!file) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT a.id id, a.num num, a.suffix suffix, a.lon lon, a.lat lat, d.name district, n.name hood, s.name street, s.kind kind
         FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id LEFT JOIN neighbourhood n ON n.id = a.hood_id
         WHERE a.num IS NOT NULL AND a.street_id IS NOT NULL`,
      )
      .all() as { id: number; num: number; suffix: string; lon: number; lat: number; district: string; hood: string | null; street: string; kind: string | null }[];
    const province = provinceName(plate) ?? plate;
    return rows.map((r) => ({ id: `${plate}:${source === 'osm' ? 'a' : 'd'}:${r.id}`, plate, source, lng: r.lon / 1e6, lat: r.lat / 1e6, province, district: r.district, hood: r.hood, street: r.street, kind: r.kind, number: `${r.num}${r.suffix.toLocaleUpperCase('tr-TR')}`, num: r.num }));
  } finally {
    db.close();
  }
}

export function writeSet(name: string, plate: string, records: unknown[]): string {
  const dir = join(setsDir(), name);
  mkdirSync(dir, { recursive: true });
  const text = JSON.stringify(records);
  writeFileSync(join(dir, `${plate}.json`), text);
  return createHash('sha256').update(text).digest('hex');
}

export function readSet<T>(name: string, plate: string): T[] {
  const file = join(setsDir(), name, `${plate}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T[]) : [];
}

export function updateManifest(name: string, hashes: { [plate: string]: string }, info: object): void {
  const path = join(repoRoot, 'fixtures', 'addr-eval', 'MANIFEST.json');
  mkdirSync(join(repoRoot, 'fixtures', 'addr-eval'), { recursive: true });
  const current = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { [k: string]: unknown }) : {};
  current[name] = { data: DATA_VERSION, ...info, files: hashes };
  writeFileSync(path, JSON.stringify(current, null, 1) + '\n');
}

export const heldOut = (lon: number, lat: number): boolean => ((Math.round(lon * 1e6) * 31 + Math.round(lat * 1e6)) >>> 0) % 10 >= 7;
