import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM, projectOnLine } from '../src/core/geo/distance';
import { decodeRings, pointInRings, type Polygon } from '../src/core/region/geom';
import { provinceName } from '../src/core/text/admin';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { partsOf } from './hints-geo';
import type { AppleQuery } from './apple-queries';

export type RawResult = { lat?: number; lng?: number; name?: string; thoroughfare?: string; subThoroughfare?: string; subLocality?: string; locality?: string; subAdministrativeArea?: string; administrativeArea?: string; postalCode?: string; radius?: number; category?: string };
export type Raw = { id: string; status: 'ok' | 'none' | 'error'; results?: RawResult[] };
export type Tier = 'A' | 'B' | 'C' | 'D';
export type Grain = 'door' | 'street' | 'area' | 'place';
export type Class = 'biz' | 'ayni' | 'apple' | 'cakisma' | 'ikisi-de-yok' | 'supheli';
export type Judged = {
  id: string;
  plate: string;
  set: string;
  cls: Class;
  tier: Tier;
  grain: Grain | null;
  why: string[];
  apple: { point: LngLat; radiusM: number | null; thoroughfare: string | null; subThoroughfare: string | null; name: string | null; subLocality: string | null; category: string | null } | null;
  oursLevel: string | null;
  apart: number | null;
  errApple: number | null;
  errOurs: number | null;
};

export type Context = {
  plate: string;
  province: string;
  districts: Map<string, Polygon[]>;
  centres: Map<string, LngLat>;
  hoods: Map<string, Polygon[]>;
  evidence: Map<string, LngLat[]>;
  streets: Map<string, LngLat[]>;
};

const DISTRICT_BUFFER_M = 1000;
const HOOD_BUFFER_M = 500;
const EVIDENCE_M = 500;
const COARSE_RADIUS_M = 1000;
const SAME_M = 100;
const OVERTURE_M = 300;
const NAME_OVERLAP = 0.8;

const SHORT: [RegExp, string][] = [[/\bcd\b\.?/gi, 'Caddesi'], [/\bcad\b\.?/gi, 'Caddesi'], [/\bsk\b\.?/gi, 'Sokak'], [/\bsok\b\.?/gi, 'Sokak'], [/\bblv\b\.?/gi, 'Bulvarı'], [/\bbul\b\.?/gi, 'Bulvarı'], [/\bmh\b\.?/gi, 'Mahallesi'], [/\bmah\b\.?/gi, 'Mahallesi'], [/\bşht\b\.?/gi, 'Şehit'], [/\bsht\b\.?/gi, 'Şehit']];

export function expandShort(text: string): string {
  let out = text;
  for (const [pattern, long] of SHORT) out = out.replace(pattern, long);
  return out;
}

const stripArea = (text: string): string => nameKey(expandShort(text)).replace(/\b(?:mahallesi|mahalle|koyu|koy)\b/g, '').replace(/\s+/g, ' ').trim();

export type StreetMatch = 'exact' | 'partial' | null;

export function matchStreet(a: string | null | undefined, b: string | null | undefined): StreetMatch {
  if (!a || !b) return null;
  const x = streetKey(expandShort(a));
  const y = streetKey(expandShort(b));
  if (x.key === '' || y.key === '') return null;
  if (x.key === y.key || (x.compact !== '' && x.compact === y.compact)) return 'exact';
  const tx = x.key.split(' ');
  const ty = y.key.split(' ');
  const [short, long] = tx.length <= ty.length ? [tx, ty] : [ty, tx];
  const numbersOf = (t: string[]): string => t.filter((w) => /\d/.test(w)).join(' ');
  if (short.length < long.length && short.every((w) => long.includes(w)) && short.some((w) => w.length >= 5) && numbersOf(short) === numbersOf(long)) return 'partial';
  return null;
}

export const sameStreet = (a: string | null | undefined, b: string | null | undefined): boolean => matchStreet(a, b) === 'exact';

export function numbersMatch(typed: string | null, apple: string | null | undefined): boolean {
  if (!typed) return true;
  if (!apple) return false;
  const a = /^(\d+)/.exec(typed.trim());
  const b = /^(\d+)/.exec(apple.trim());
  return !!a && !!b && a[1] === b[1];
}

export function nameOverlap(wanted: string, got: string): number {
  const w = nameKey(wanted).split(' ').filter((t) => t.length > 1);
  const g = new Set(nameKey(got).split(' '));
  return w.length === 0 ? 0 : w.filter((t) => g.has(t)).length / w.length;
}

export function insideBuffered(point: LngLat, polygons: Polygon[] | undefined, bufferM: number): boolean {
  if (!polygons || polygons.length === 0) return false;
  if (pointInRings(point, polygons)) return true;
  for (const polygon of polygons) for (const ring of polygon) if (projectOnLine(point, ring as LngLat[]).distanceM <= bufferM) return true;
  return false;
}

const ordered = (list: RawResult[]): { point: LngLat; r: RawResult }[] => list.filter((r) => typeof r.lat === 'number' && typeof r.lng === 'number').map((r) => ({ point: [r.lng as number, r.lat as number] as LngLat, r }));

function evaluate(q: AppleQuery, point: LngLat, r: RawResult, ctx: Context): { tier: Tier; grain: Grain | null; why: string[] } {
  const why: string[] = [];
  if (r.administrativeArea && nameKey(r.administrativeArea) !== nameKey(ctx.province)) why.push('il');
  const polygons = ctx.districts.get(q.district);
  const centre = ctx.centres.get(q.district);
  const inDistrict = polygons ? insideBuffered(point, polygons, DISTRICT_BUFFER_M) : centre ? distanceM(point, centre) <= 15000 : false;
  if (!inDistrict) why.push('ilçe');
  const radius = typeof r.radius === 'number' ? r.radius : null;
  if (q.set === 'alan') {
    const squash = (t: string): string => t.replace(/\s+/g, '');
    const got = [r.subLocality, r.locality, r.name].filter((x): x is string => !!x).map((x) => squash(stripArea(x)));
    const want = squash(stripArea(q.hood ?? ''));
    if (want === '' || !got.some((g) => g === want)) why.push(rough(r, q) ? 'kaba' : 'ad');
    if (why.length > 0) return { tier: 'D', grain: null, why };
    const hood = ctx.hoods.get(`${nameKey(q.district)}|${nameKey(q.hood ?? '')}`);
    return { tier: hood && pointInRingsSafe(point, hood) ? 'A' : 'B', grain: 'area', why };
  }
  if (q.set === 'ad') {
    const name = q.text.slice(0, Math.max(0, q.text.length - q.district.length - ctx.province.length - 2)).trim();
    if (nameOverlap(name, r.name ?? '') < NAME_OVERLAP) why.push(rough(r, q) ? 'kaba' : 'ad');
    if (why.length > 0) return { tier: 'D', grain: null, why };
    return { tier: q.truth && distanceM(point, q.truth) <= OVERTURE_M ? 'A' : 'B', grain: 'place', why };
  }
  const match = matchStreet(r.thoroughfare, q.street);
  if (!match) why.push(rough(r, q) ? 'kaba' : 'sokak');
  if (why.length > 0) return { tier: 'D', grain: null, why };
  const hoodTyped = q.hood && q.text.includes(`${q.hood} Mahallesi`);
  const hood = hoodTyped ? ctx.hoods.get(`${nameKey(q.district)}|${nameKey(q.hood as string)}`) : undefined;
  const hoodOk = !hoodTyped || !hood || insideBuffered(point, hood, HOOD_BUFFER_M);
  if (!hoodOk) why.push('mahalle');
  const pois = ctx.evidence.get(`${nameKey(q.district)}|${streetKey(q.street ?? '').key}`) ?? [];
  const evidence = pois.some((p) => distanceM(p, point) <= EVIDENCE_M);
  const coarse = radius !== null && radius > COARSE_RADIUS_M;
  if (why.length > 0) return { tier: 'D', grain: null, why };
  if (match === 'partial') why.push('kismi-ad');
  const best = (strong: boolean): Tier => (strong && match === 'exact' ? 'A' : 'B');
  if (q.number !== null && numbersMatch(q.number, r.subThoroughfare) && r.subThoroughfare && !coarse) return { tier: best(evidence), grain: 'door', why };
  if (q.number !== null) why.push('numara');
  return { tier: q.number !== null ? 'C' : best(evidence), grain: 'street', why };
}

function rough(r: RawResult, q: AppleQuery): boolean {
  if (r.thoroughfare) return false;
  const areas = [q.district, r.locality, r.subLocality, r.subAdministrativeArea].filter((x): x is string => !!x).map((x) => nameKey(x));
  return !!r.name && areas.includes(nameKey(r.name));
}

const pointInRingsSafe = (point: LngLat, polygons: Polygon[]): boolean => {
  try {
    return pointInRings(point, polygons);
  } catch {
    return false;
  }
};

const STREET_NEAR_M = 250;
const MIN_REACH_M = 150;
const AREA_REACH_M = 1500;

function agrees(q: AppleQuery, point: LngLat, apart: number | null, ctx: Context): boolean {
  if (q.set === 'alan') {
    const hood = ctx.hoods.get(`${nameKey(q.district)}|${nameKey(q.hood ?? '')}`);
    return hood ? insideBuffered(point, hood, HOOD_BUFFER_M) : apart !== null && apart <= AREA_REACH_M;
  }
  const line = q.street ? ctx.streets.get(`${nameKey(q.district)}|${streetKey(q.street).key}`) : undefined;
  if (line && line.length > 0 && q.ours.source !== 'learned') return line.some((p) => distanceM(p, point) <= STREET_NEAR_M);
  if (q.ours.level === 'sokak' && apart !== null) return apart <= Math.max(q.ours.radiusM ?? 0, MIN_REACH_M);
  return false;
}

const LEVELS = ['il', 'ilçe', 'mahalle', 'sokak', 'kapı'];
const levelOf = (level: string | null): number => (level === null ? -1 : LEVELS.indexOf(level));

export function judgeOne(q: AppleQuery, raw: Raw | undefined, ctx: Context): Judged {
  const base: Judged = { id: q.id, plate: q.plate, set: q.set, cls: 'ikisi-de-yok', tier: 'D', grain: null, why: [], apple: null, oursLevel: q.ours.level, apart: null, errApple: null, errOurs: null };
  const ours = q.ours.coordinate;
  const errOurs = ours && q.truth && (q.set === 'kapi' || q.set === 'ad') ? distanceM(ours, q.truth) : null;
  if (!raw || raw.status !== 'ok' || !raw.results?.length) return { ...base, cls: q.ours.level === null ? 'ikisi-de-yok' : 'biz', why: raw?.status === 'error' ? ['hata'] : ['apple-yok'], errOurs };
  const candidates = ordered(raw.results).map((c) => ({ ...c, ...evaluate(q, c.point, c.r, ctx) }));
  const rank: Record<Tier, number> = { A: 3, B: 2, C: 1, D: 0 };
  const best = [...candidates].sort((a, b) => rank[b.tier] - rank[a.tier])[0] ?? candidates[0];
  if (!best) return { ...base, why: ['nokta-yok'], errOurs };
  const apple = { point: best.point, radiusM: typeof best.r.radius === 'number' ? Math.round(best.r.radius) : null, thoroughfare: best.r.thoroughfare ?? null, subThoroughfare: best.r.subThoroughfare ?? null, name: best.r.name ?? null, subLocality: best.r.subLocality ?? null, category: best.r.category ?? null };
  const apart = ours ? distanceM(ours, best.point) : null;
  const errApple = q.truth && (q.set === 'kapi' || q.set === 'ad') ? distanceM(best.point, q.truth) : null;
  const common = { ...base, tier: best.tier, grain: best.grain, why: best.why, apple, apart, errApple, errOurs };
  if (best.tier === 'D') return { ...common, cls: best.why.includes('kaba') ? (q.ours.level === null ? 'ikisi-de-yok' : 'biz') : 'supheli' };
  const have = levelOf(q.ours.level);
  const wanted = best.grain === 'door' ? 4 : best.grain === 'street' ? 3 : best.grain === 'area' ? 2 : 3;
  const exact = q.set === 'kapi' && q.ours.source === 'osm' && q.ours.level === 'kapı';
  if (exact) return { ...common, cls: apart !== null && apart < SAME_M ? 'ayni' : 'biz' };
  const wrongStreet = q.set === 'eksik' && q.ours.level === 'sokak' && q.ours.source !== 'learned';
  if (have < wanted || wrongStreet || q.ours.level === null) return { ...common, cls: 'apple' };
  if (apart !== null && apart < SAME_M) return { ...common, cls: 'ayni' };
  if (agrees(q, best.point, apart, ctx)) return { ...common, cls: 'ayni' };
  if (errOurs !== null && errApple !== null) return { ...common, cls: errApple + 20 < errOurs ? 'apple' : errOurs + 20 < errApple ? 'biz' : 'ayni' };
  return { ...common, cls: 'cakisma' };
}

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
export type Dirs = { queries: string; raw: string; judged: string };
const apple = join(repoRoot, 'dist', 'apple');
export const MAIN_DIRS: Dirs = { queries: join(apple, 'queries'), raw: join(apple, 'raw'), judged: join(apple, 'judged') };
export const WAYS_DIRS: Dirs = { queries: join(apple, 'queries-ways'), raw: join(apple, 'raw-ways'), judged: join(apple, 'judged-ways') };
export const rawDir = MAIN_DIRS.raw;
export const judgedDir = MAIN_DIRS.judged;
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

export function contextOf(plate: string): Context {
  const dir = join(packs, plate);
  const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const districts = new Map<string, Polygon[]>();
    const centres = new Map<string, LngLat>();
    for (const d of addr.prepare('SELECT name, cx, cy, poly FROM district').all() as { name: string; cx: number; cy: number; poly: Uint8Array }[]) {
      districts.set(d.name, decodeRings(d.poly));
      centres.set(d.name, [d.cx / 1e6, d.cy / 1e6]);
    }
    const hoods = new Map<string, Polygon[]>();
    for (const h of addr.prepare('SELECT h.name name, d.name district, h.poly poly FROM neighbourhood h JOIN district d ON d.id = h.district_id WHERE h.poly IS NOT NULL').all() as { name: string; district: string; poly: Uint8Array }[]) {
      try {
        hoods.set(`${nameKey(h.district)}|${nameKey(h.name)}`, decodeRings(h.poly));
      } catch {
        continue;
      }
    }
    const evidence = new Map<string, LngLat[]>();
    for (const r of directory.prepare('SELECT d.name district, t.text street, p.lon lon, p.lat lat FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id').all() as { district: string; street: string; lon: number; lat: number }[]) {
      const key = `${nameKey(r.district)}|${streetKey(r.street).key}`;
      evidence.set(key, [...(evidence.get(key) ?? []), [r.lon / 1e6, r.lat / 1e6]]);
    }
    const streets = new Map<string, LngLat[]>();
    for (const [key, parts] of partsOf(addr)) streets.set(key, parts.flatMap((p) => p.points as LngLat[]));
    return { plate, province: provinceName(plate) ?? plate, districts, centres, hoods, evidence, streets };
  } finally {
    addr.close();
    directory.close();
  }
}

export function judgePlate(plate: string, dirs: Dirs = MAIN_DIRS): Judged[] {
  const queries = jsonl<AppleQuery>(join(dirs.queries, `${plate}.jsonl`));
  const raws = new Map(jsonl<Raw>(join(dirs.raw, `${plate}.jsonl`)).map((r) => [r.id, r]));
  const ctx = contextOf(plate);
  return queries.filter((q) => raws.has(q.id)).map((q) => judgeOne(q, raws.get(q.id), ctx));
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const dirs = process.argv.includes('--ways') ? WAYS_DIRS : MAIN_DIRS;
  mkdirSync(dirs.judged, { recursive: true });
  for (const plate of plates) {
    if (!existsSync(join(dirs.raw, `${plate}.jsonl`))) continue;
    const judged = judgePlate(plate, dirs);
    writeFileSync(join(dirs.judged, `${plate}.jsonl`), judged.map((j) => JSON.stringify(j)).join('\n') + '\n');
    const count = (f: (j: Judged) => string): string => JSON.stringify(judged.reduce<Record<string, number>>((m, j) => ({ ...m, [f(j)]: (m[f(j)] ?? 0) + 1 }), {}));
    console.log(plate, judged.length, 'sınıf', count((j) => j.cls), 'katman', count((j) => j.tier));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
