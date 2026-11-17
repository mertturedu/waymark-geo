import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import type { LngLat } from '../src/core/geo/cells';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle, type Rand } from '../test/sim/random';
import { repoRoot } from './addr-sets';
import { groupsOf } from './hints-overture';
import { knownStreets } from './hints-geo';

export type MainSet = 'kapi' | 'sokak' | 'eksik' | 'alan' | 'ad';
export type QuerySet = MainSet | 'bosnum' | 'yol';
export type Ours = { status: string; level: string | null; source: string | null; precision: string | null; approximate: boolean | null; coordinate: LngLat | null; radiusM?: number | null; components?: { district: string | null; neighbourhood: string | null; street: string | null } };
export type AppleQuery = { id: string; plate: string; set: QuerySet; text: string; district: string; center: LngLat | null; hood: string | null; street: string | null; number: string | null; truth: LngLat | null; ours: Ours };

export const PER_SET: Record<MainSet, number> = { kapi: 150, sokak: 100, eksik: 100, alan: 75, ad: 75 };
export const TOTAL = 500;

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const queriesDir = join(repoRoot, 'dist', 'apple', 'queries');
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));

const ABBREVIATIONS: [RegExp, string][] = [[/(?<!\p{L})Caddesi(?!\p{L})/u, 'Cd.'], [/(?<!\p{L})(?:Sokak|Sokağı)(?!\p{L})/u, 'Sk.'], [/(?<!\p{L})Bulvarı(?!\p{L})/u, 'Blv.']];

export function abbreviate(street: string): string {
  for (const [pattern, short] of ABBREVIATIONS) if (pattern.test(street)) return street.replace(pattern, short);
  return street;
}

export function roundRobin<T>(groups: Map<string, T[]>, count: number, rand: Rand, accept: (item: T, picked: T[]) => boolean = () => true): T[] {
  const lists = shuffle([...groups.entries()], rand).map(([, list]) => shuffle(list, rand));
  const out: T[] = [];
  for (let round = 0; out.length < count; round++) {
    let any = false;
    for (const list of lists) {
      if (out.length >= count) break;
      while (list.length > 0 && !accept(list[0] as T, out)) list.shift();
      const item = list.shift();
      if (item === undefined) continue;
      any = true;
      out.push(item);
    }
    if (!any) break;
  }
  return out;
}

const bucket = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(key(item), [...(out.get(key(item)) ?? []), item]);
  return out;
}

type Draft = { set: QuerySet; text: string; district: string; hood: string | null; street: string | null; number: string | null; truth: LngLat | null };

function doorDrafts(db: DatabaseSync, province: string, rand: Rand, count: number): Draft[] {
  const rows = db.prepare('SELECT s.name street, a.number number, d.name district, h.name hood, a.lon lon, a.lat lat FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id LEFT JOIN neighbourhood h ON h.id = a.hood_id WHERE a.number IS NOT NULL AND a.number != \'\' AND length(a.number) <= 5 ORDER BY (a.id * 2654435761) % 1000003 LIMIT 40000').all() as { street: string; number: string; district: string; hood: string | null; lon: number; lat: number }[];
  const streets = new Map<string, number>();
  const picked = roundRobin(bucket(rows, (r) => r.district), count, rand, (r, chosen) => {
    const key = `${r.district}|${r.street}`;
    return (streets.get(key) ?? 0) < 2 && !chosen.includes(r);
  });
  return picked.map((r, i): Draft => {
    streets.set(`${r.district}|${r.street}`, (streets.get(`${r.district}|${r.street}`) ?? 0) + 1);
    const form = i % 10;
    const street = form === 9 ? abbreviate(r.street) : r.street;
    const area = form < 4 && r.hood ? `${r.hood} Mahallesi ${r.district}` : r.district;
    return { set: 'kapi', text: `${street} No:${r.number} ${area} ${province}`, district: r.district, hood: r.hood, street: r.street, number: r.number, truth: [r.lon / 1e6, r.lat / 1e6] };
  });
}

function streetDrafts(db: DatabaseSync, province: string, rand: Rand, count: number): Draft[] {
  const rows = db.prepare('SELECT DISTINCT s.name street, d.name district FROM street_part p JOIN street_name s ON s.id = p.name_id JOIN district d ON d.id = p.district_id').all() as { street: string; district: string }[];
  return roundRobin(bucket(rows, (r) => r.district), count, rand).map((r): Draft => ({ set: 'sokak', text: `${r.street} ${r.district} ${province}`, district: r.district, hood: null, street: r.street, number: null, truth: null }));
}

function missingDrafts(addr: DatabaseSync, directory: DatabaseSync, province: string, rand: Rand, count: number): Draft[] {
  const known = knownStreets(addr);
  const numbers = new Map<string, string[]>();
  for (const r of directory.prepare('SELECT d.name district, t.text street, i.number number FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL').all() as { district: string; street: string; number: string }[]) {
    const key = `${nameKey(r.district)}|${streetKey(r.street).key}`;
    numbers.set(key, [...(numbers.get(key) ?? []), r.number]);
  }
  const rows: { street: string; district: string; n: number; number: string | null; point: LngLat }[] = [];
  for (const [id, g] of groupsOf(directory)) {
    if (known.byDistrict.has(id)) continue;
    const name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const door = (numbers.get(id) ?? []).find((n) => /^\d{1,4}$/.test(n)) ?? null;
    rows.push({ street: name, district: g.district, n: g.pois.length, number: door, point: g.pois[0]!.point });
  }
  const strata = bucket(rows, (r) => (r.n === 1 ? 'a' : r.n <= 4 ? 'b' : 'c'));
  const share: Record<string, number> = { a: 0.4, b: 0.3, c: 0.3 };
  const out: Draft[] = [];
  for (const [key, list] of strata) {
    for (const r of roundRobin(bucket(list, (x) => x.district), Math.round(count * (share[key] ?? 0)), rand)) {
      const district = directoryDistrict(directory, r.district) ?? r.district;
      out.push({ set: 'eksik', text: r.number ? `${r.street} No:${r.number} ${district} ${province}` : `${r.street} ${district} ${province}`, district, hood: null, street: r.street, number: r.number, truth: null });
    }
  }
  return out;
}

const districtNames = new WeakMap<DatabaseSync, Map<string, string>>();
function directoryDistrict(db: DatabaseSync, key: string): string | null {
  let map = districtNames.get(db);
  if (!map) {
    map = new Map((db.prepare('SELECT name FROM district').all() as { name: string }[]).map((d) => [nameKey(d.name), d.name]));
    districtNames.set(db, map);
  }
  return map.get(key) ?? null;
}

function areaDrafts(db: DatabaseSync, province: string, rand: Rand, count: number): Draft[] {
  const rows = db.prepare('SELECT h.name name, h.source source, d.name district, h.cx cx, h.cy cy FROM neighbourhood h JOIN district d ON d.id = h.district_id').all() as { name: string; source: number; district: string; cx: number | null; cy: number | null }[];
  return roundRobin(bucket(rows, (r) => String(r.source)), count, rand).map((r): Draft => ({ set: 'alan', text: `${r.name} ${r.district} ${province}`, district: r.district, hood: r.name, street: null, number: null, truth: r.cx !== null && r.cy !== null ? [r.cx / 1e6, r.cy / 1e6] : null }));
}

const GENERIC = /^(?:\d+|[a-zçğıöşü]{1,3})$/i;

function nameDrafts(directory: DatabaseSync, province: string, rand: Rand, count: number): Draft[] {
  const rows = directory.prepare('SELECT p.name name, k.name kind, d.name district, p.lon lon, p.lat lat FROM poi p JOIN poi_kind k ON k.id = p.kind JOIN district d ON d.id = p.district_id JOIN poi_info i ON i.id = p.id WHERE i.conf >= 70 AND length(p.name) >= 5').all() as { name: string; kind: string; district: string; lon: number; lat: number }[];
  const usable = rows.filter((r) => !GENERIC.test(r.name.trim()));
  return roundRobin(bucket(usable.filter((r) => !/^unnamed/i.test(r.name)), (r) => r.kind), count, rand, (r, chosen) => !chosen.some((c) => c.name === r.name && c.district === r.district)).map((r): Draft => ({ set: 'ad', text: `${r.name} ${r.district} ${province}`, district: r.district, hood: null, street: null, number: null, truth: [r.lon / 1e6, r.lat / 1e6] }));
}

export function draftsOf(plate: string, addr: DatabaseSync, directory: DatabaseSync): Draft[] {
  const province = provinceName(plate) ?? plate;
  const rand = rng(Number(plate) * 7919 + 20261114);
  const parts: Record<MainSet, Draft[]> = {
    kapi: doorDrafts(addr, province, rand, PER_SET.kapi),
    sokak: streetDrafts(addr, province, rand, PER_SET.sokak),
    eksik: missingDrafts(addr, directory, province, rand, PER_SET.eksik),
    alan: areaDrafts(addr, province, rand, PER_SET.alan),
    ad: nameDrafts(directory, province, rand, PER_SET.ad),
  };
  const out = (Object.keys(PER_SET) as MainSet[]).flatMap((k) => parts[k]);
  if (out.length >= TOTAL) return out.slice(0, TOTAL);
  const extra = doorDrafts(addr, province, rng(Number(plate) + 3), TOTAL).filter((d) => !out.some((o) => o.text === d.text));
  return [...out, ...extra].slice(0, TOTAL);
}

export async function oursOf(plate: string, texts: readonly string[]): Promise<Ours[]> {
  const dir = join(packs, plate);
  const dbs = [openSqlite(join(dir, 'address.sqlite'))];
  const parts = new Map<string, ReturnType<typeof openSqlite>>();
  const store: PackStore = {
    installed: async () => [plate],
    open: async () => dbs[0]!,
    openPart: async (_r, kind) => {
      const file = kind === 'learned' || kind === 'directory' || kind === 'buildings2' ? join(dir, `${kind}.sqlite`) : null;
      if (!file || !existsSync(file)) return null;
      if (!parts.has(kind)) parts.set(kind, openSqlite(file));
      return parts.get(kind)!;
    },
  };
  try {
    const search = createSearch({ store, borders, layers: [createLearnedLayer(store)] });
    const out: Ours[] = [];
    for (const text of texts) {
      const result = await search.resolve(text);
      const first = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      const level = first ? (first.components.houseNumber ? 'kapı' : first.components.street ? 'sokak' : first.components.neighbourhood ? 'mahalle' : first.components.district ? 'ilçe' : 'il') : null;
      out.push({ status: result.status, level, source: first?.source ?? null, precision: first?.precision ?? null, approximate: first?.approximate ?? null, coordinate: (first?.coordinate as LngLat | undefined) ?? null, radiusM: first?.radiusM ?? null, components: { district: first?.components.district ?? null, neighbourhood: first?.components.neighbourhood ?? null, street: first?.components.street ?? null } });
    }
    return out;
  } finally {
    await dbs[0]!.close();
    for (const db of parts.values()) await db.close();
  }
}

export async function queriesOf(plate: string): Promise<AppleQuery[] | null> {
  const dir = join(packs, plate);
  if (!['address', 'directory', 'learned'].every((n) => existsSync(join(dir, `${n}.sqlite`)))) return null;
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const drafts = draftsOf(plate, addr, directory);
    const ours = await oursOf(plate, drafts.map((d) => d.text));
    const centres = new Map((addr.prepare('SELECT name, cx, cy FROM district').all() as { name: string; cx: number; cy: number }[]).map((d) => [d.name, [d.cx / 1e6, d.cy / 1e6] as LngLat]));
    return drafts.map((d, i): AppleQuery => ({ id: `q-${plate}-${String(i).padStart(3, '0')}`, plate, ...d, center: centres.get(d.district) ?? null, ours: ours[i] as Ours }));
  } finally {
    addr.close();
    directory.close();
  }
}

export async function refreshOurs(plate: string): Promise<number> {
  const file = join(queriesDir, `${plate}.jsonl`);
  if (!existsSync(file)) return 0;
  const queries = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as AppleQuery);
  const ours = await oursOf(plate, queries.map((q) => q.text));
  writeFileSync(file, queries.map((q, i) => JSON.stringify({ ...q, ours: ours[i] })).join('\n') + '\n');
  return queries.length;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  if (process.argv.includes('--refresh')) {
    for (const plate of only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'))) console.log(plate, await refreshOurs(plate));
    return;
  }
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  mkdirSync(queriesDir, { recursive: true });
  let total = 0;
  for (const plate of plates) {
    const list = await queriesOf(plate);
    if (!list) continue;
    writeFileSync(join(queriesDir, `${plate}.jsonl`), list.map((q) => JSON.stringify(q)).join('\n') + '\n');
    total += list.length;
    const bySet = Object.fromEntries((Object.keys(PER_SET) as MainSet[]).map((k) => [k, list.filter((q) => q.set === k).length]));
    console.log(JSON.stringify({ plate, n: list.length, ...bySet }));
  }
  console.log(JSON.stringify({ total }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
