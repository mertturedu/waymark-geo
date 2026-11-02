import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { findProvince, provinceName } from '../src/core/text/admin';
import { NUMBER as HOUSE_NUMBER, isCleanStreet } from './build-address-records';
import { createNodePackStore } from '../src/node/pack-store';
import type { SqlDb } from '../src/core/ports';
import type { Lang } from '../src/core/text/types';
import { generateSentences } from '../test/text/helpers/sentence-generator';
import type { AddressRecord } from '../test/text/helpers/types';

export type RowSource = {
  osm: string;
  number: string;
  province: string;
  provinceName: string;
  district: string;
  hood: string | null;
  street: string;
  streetNumber: number | null;
  lng: number;
  lat: number;
  conflict: boolean;
  unique?: boolean;
  districtNames: Record<string, string>;
  hoodNames: Record<string, string>;
};
export type PoiSource = { osm: string; name: string; kind: string; district: string; province: string; lng: number; lat: number };
export type Category = 'full' | 'folded' | 'typo' | 'numbered' | 'hide' | 'poi' | 'lang' | 'hard';
export type GoldenQuery = {
  id: string;
  text: string;
  category: Category;
  lang: Lang;
  conflict?: boolean;
  expect: { plate: string; osm: string; number?: string; streetName?: string; streetNumber?: number; kind?: string; truth?: [number, number] };
};

const PLAIN: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
export const asciiFold = (text: string): string => Array.from(text).map((ch) => PLAIN[ch] ?? ch).join('');

export const osmName = (code: number): string => `${['n', 'w', 'r'][code % 4]}${Math.floor(code / 4)}`;

export type Rng = () => number;

export function rngOf(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(next: Rng, list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;

function shuffled<T>(list: T[], next: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const PUNCTUATION = /[()/]|\bkm\b|\bmah(alle(si)?)?\b|\b(cadde|caddesi|bulvar|bulvarı|sokak|sokağı)\s+(yan\s?yol|servis\s?yol)/i;

export function noisyStreet(name: string): boolean {
  if (PUNCTUATION.test(name)) return true;
  const words = name.split(/\s+/);
  const inner = words.slice(1).some((w) => findProvince(w) !== null);
  const lone = words.slice(1).some((w) => /^\d+\.?$/.test(w)) && !/^\d/.test(words[0] as string);
  const dashed = /\b[A-Z]-\d+\b/.test(name);
  return inner || lone || dashed;
}

const LETTERS = 'abcdefghilmnoprstuvyz';
const lower = (text: string): string => asciiFold(text).toLowerCase();

export function typoOf(word: string, next: Rng): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    const at = 1 + Math.floor(next() * (word.length - 2));
    const kind = Math.floor(next() * 4);
    let out = word;
    if (kind === 0) out = word.slice(0, at) + pick(next, LETTERS.split('')) + word.slice(at + 1);
    else if (kind === 1) out = word.slice(0, at) + word.slice(at + 1);
    else if (kind === 2) out = word.slice(0, at) + pick(next, LETTERS.split('')) + word.slice(at);
    else out = word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
    if (lower(out) !== lower(word)) return out;
  }
  return word.slice(0, 1) + word.slice(2);
}

const KIND_WORD = /\s+(caddesi|cadde|sokağı|sokak|bulvarı|bulvar|yolu|yol|çıkmazı|çıkmaz|meydanı|meydan)$/i;
const ABBREVIATION: [RegExp, string[]][] = [[/\s+(caddesi|cadde)$/i, ['Cd.', 'Cad.', 'Cd']], [/\s+(sokağı|sokak)$/i, ['Sk.', 'Sok.', 'Sk']], [/\s+(bulvarı|bulvar)$/i, ['Blv.', 'Bulv.']]];

function abbreviate(street: string, next: Rng): string {
  for (const [pattern, words] of ABBREVIATION) if (pattern.test(street)) return street.replace(pattern, ` ${pick(next, words)}`);
  return street;
}

const longWord = (street: string): string | null => {
  const words = street.replace(KIND_WORD, '').split(/\s+/).filter((w) => /^[A-Za-zÇĞİÖŞÜçğıöşü]+$/.test(w) && w.length > 5);
  return words.sort((a, b) => b.length - a.length)[0] ?? null;
};

function full(r: RowSource, variant: number): string {
  const hood = r.hood as string;
  const forms = [
    `${r.provinceName} ${r.district} ${hood} Mah. ${r.street} No:${r.number}`,
    `${r.street} No:${r.number} ${hood} Mahallesi ${r.district}/${r.provinceName}`,
    `${hood} Mah. ${r.street} ${r.number}, ${r.district}, ${r.provinceName}`,
    `${r.provinceName}, ${r.district}, ${hood} Mahallesi, ${r.street}, Kapı No: ${r.number}`,
  ];
  return forms[variant % forms.length] as string;
}

function expectOf(plate: string, r: RowSource, extra: Partial<GoldenQuery['expect']> = {}): GoldenQuery['expect'] {
  return { plate, osm: r.osm, number: r.number, streetName: r.street, ...(r.streetNumber !== null ? { streetNumber: r.streetNumber } : {}), ...extra };
}

function poiVariants(p: PoiSource, next: Rng): string[] {
  const base = `${p.name} ${p.district} ${p.province}`;
  const out = [base, lower(base), `${p.name} ${p.district}`];
  const trimmed = p.name.replace(/\s+hastanesi$/i, ' hastane').replace(/\s+belediyesi$/i, ' belediye binası').replace(/\s+ilkokulu$/i, ' ilkokul').replace(/\s+ortaokulu$/i, ' ortaokul');
  if (trimmed !== p.name) out.push(`${trimmed} ${p.district}`, lower(`${trimmed} ${p.district} ${p.province}`));
  return shuffled(out, next);
}

const QUOTA = { full: 100, folded: 60, typo: 60, numbered: 30, hide: 40, poi: 30, langRows: 6, hard: 12 };

export function buildQueries(rows: RowSource[], pois: PoiSource[], plate: string, seed: number): GoldenQuery[] {
  const next = rngOf(seed);
  const queries: GoldenQuery[] = [];
  const add = (category: Category, lang: Lang, text: string, expect: GoldenQuery['expect'], conflict = false): void => {
    queries.push({ id: `${plate}-${category}-${queries.filter((q) => q.category === category).length + 1}`, text, category, lang, ...(conflict ? { conflict: true } : {}), expect });
  };
  const usable = rows.filter((r) => r.hood !== null && HOUSE_NUMBER.test(r.number) && isCleanStreet(r.street) && !noisyStreet(r.street));
  const clean = shuffled(usable.filter((r) => !r.conflict), next);
  const plain = clean.filter((r) => r.streetNumber === null);
  const numbered = clean.filter((r) => r.streetNumber !== null);
  const unique = plain.filter((r) => r.unique !== false);
  const cyclic = <T>(pool: T[], count: number, offset: number): T[] => (pool.length === 0 ? [] : Array.from({ length: count }, (_, i) => pool[(offset + i) % pool.length] as T));

  cyclic(plain, QUOTA.full, 0).forEach((r, i) => add('full', 'tr', full(r, i), expectOf(plate, r)));
  for (const r of shuffled(usable.filter((x) => x.conflict), next).slice(0, 5)) add('full', 'tr', full(r, 0), expectOf(plate, r), true);
  cyclic(plain, QUOTA.folded, QUOTA.full).forEach((r) => {
    const text = `${r.provinceName} ${r.district} ${r.hood} mah ${abbreviate(r.street, next)} no ${r.number}`;
    add('folded', 'tr', next() < 0.25 ? asciiFold(text).toUpperCase() : lower(text), expectOf(plate, r));
  });
  const typoPool = plain.filter((r) => longWord(r.street) !== null && !lower(`${r.hood} ${r.district}`).includes(lower(r.street)));
  cyclic(typoPool, QUOTA.typo, 0).forEach((r, i) => {
    const word = longWord(r.street) as string;
    add('typo', 'tr', full({ ...r, street: r.street.replace(word, typoOf(word, next)) }, i), expectOf(plate, r));
  });
  cyclic(numbered, QUOTA.numbered, 0).forEach((r, i) => add('numbered', 'tr', full(r, i), expectOf(plate, r)));
  cyclic(plain, QUOTA.hide, QUOTA.full + QUOTA.folded).forEach((r) => add('hide', 'tr', full(r, 2), expectOf(plate, r, { truth: [r.lng, r.lat] })));

  const perKind = new Map<string, number>();
  for (const p of shuffled(pois, next)) {
    if ((perKind.get(p.kind) ?? 0) >= 10 || [...perKind.values()].reduce((a, b) => a + b, 0) >= QUOTA.poi) continue;
    perKind.set(p.kind, (perKind.get(p.kind) ?? 0) + 1);
    const variants = poiVariants(p, next);
    add('poi', 'tr', variants[0] as string, { plate, osm: p.osm, kind: p.kind, streetName: p.name });
  }
  for (const p of shuffled(pois.filter((x) => /belediyesi$/i.test(x.name)), next).slice(0, 3)) add('poi', 'tr', lower(`${p.name.replace(/belediyesi$/i, 'belediye binası')} ${p.district}`), { plate, osm: p.osm, kind: p.kind, streetName: p.name });

  const langPool = (unique.length >= QUOTA.langRows ? unique : plain).slice(QUOTA.full % Math.max(1, unique.length));
  cyclic(langPool, QUOTA.langRows, 0).forEach((r, k) => {
    const record: AddressRecord = { province: plate, provinceName: r.provinceName, district: r.district, districtNames: { tr: r.district, ...r.districtNames }, neighbourhood: r.hood, neighbourhoodNames: { tr: r.hood as string, ...r.hoodNames }, street: r.street, houseNumber: r.number };
    const cases = generateSentences([record], 9, seed + k * 101);
    for (const c of cases.slice(4, 9)) add('lang', c.lang, c.text, expectOf(plate, r));
  });

  const hardPool = (unique.length >= QUOTA.hard ? unique : plain);
  const hard: ((r: RowSource) => string)[] = [
    (r) => `${r.street} ${r.number} ${r.hood}`,
    (r) => `${r.hood} mah ${r.street} no:${r.number} d:3 kat:2 ${r.district}`,
    (r) => `${r.district} ${r.street} no${r.number}`,
    (r) => `${r.number} ${r.street} ${r.hood} ${r.district}`,
    (r) => lower(`${r.hood} ${r.street} ${r.number}`).toUpperCase(),
    (r) => `${r.district} ${r.street} apartmanı ${r.number} numara`,
    (r) => `${r.hood} mahallesi ${r.street} ${r.number} nolu bina ${r.district}/${r.provinceName}`,
    (r) => `${r.street.replace(KIND_WORD, '')} ${r.number} ${r.hood} ${r.district}`,
    (r) => `${typoOf(r.hood as string, next)} mah ${r.street} ${r.number} ${r.district}`,
    (r) => `${r.street} ${r.number} ${r.hood} mh`,
    (r) => `${r.district} ${r.hood} ${r.street} ${r.number}, 34${100 + (r.number.length * 37) % 900}`,
    (r) => `${r.provinceName} ${r.district} ${r.street} ${r.number} ${r.hood}`,
  ];
  cyclic(hardPool, QUOTA.hard, 7).forEach((r, i) => add('hard', 'tr', (hard[i % hard.length] as (r: RowSource) => string)({ ...r, hood: r.hood as string }), expectOf(plate, r)));

  let filler = 0;
  while (queries.length < 300 && plain.length > 0) {
    const r = plain[filler % plain.length] as RowSource;
    add('full', 'tr', full(r, filler + 1), expectOf(plate, r));
    filler += 1;
  }
  return queries;
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PRIORITY = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];

export async function sourcesOf(db: SqlDb, plate: string): Promise<{ rows: RowSource[]; pois: PoiSource[]; districts: number }> {
  const region = await openRegion(db);
  const raw = await db.all<{ osm: number; number: string; nkey: string; lon: number; lat: number; hood_id: number | null; district_id: number; street_id: number; street: string; snum: number | null; hood: string | null; district: string }>(
    'SELECT a.osm, a.number, a.nkey, a.lon, a.lat, a.hood_id, a.district_id, a.street_id, s.name AS street, s.number AS snum, h.name AS hood, d.name AS district FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id LEFT JOIN neighbourhood h ON h.id = a.hood_id WHERE a.num IS NOT NULL ORDER BY a.id',
  );
  const groups = new Map<string, typeof raw>();
  const places = new Map<number, Set<string>>();
  for (const r of raw) {
    groups.set(`${r.street_id}:${r.hood_id}:${r.nkey}`, [...(groups.get(`${r.street_id}:${r.hood_id}:${r.nkey}`) ?? []), r]);
    places.set(r.street_id, (places.get(r.street_id) ?? new Set()).add(`${r.district_id}:${r.hood_id}`));
  }
  const meters = (a: (typeof raw)[number], b: (typeof raw)[number]): number => Math.hypot((a.lon - b.lon) * 0.084, (a.lat - b.lat) * 0.1112);
  const rows: RowSource[] = raw.map((r) => {
    const same = groups.get(`${r.street_id}:${r.hood_id}:${r.nkey}`) ?? [];
    const conflict = same.length > 1 && same.some((o) => meters(r, o) > 30);
    return { osm: osmName(r.osm), number: r.number, province: plate, provinceName: provinceName(plate) ?? plate, district: r.district, hood: r.hood, street: r.street, streetNumber: r.snum, lng: r.lon / 1e6, lat: r.lat / 1e6, conflict, unique: (places.get(r.street_id)?.size ?? 0) === 1, districtNames: {}, hoodNames: {} };
  });
  const poiRows = await db.all<{ osm: number; name: string; kind: string; district: string; lon: number; lat: number; dup: number }>(
    "SELECT p.osm, p.name, k.name AS kind, d.name AS district, p.lon, p.lat, (SELECT COUNT(*) FROM poi q WHERE q.name = p.name AND q.district_id = p.district_id) AS dup FROM poi p JOIN poi_kind k ON k.id = p.kind JOIN district d ON d.id = p.district_id WHERE k.name IN ('hospital', 'townhall', 'school', 'mall') ORDER BY p.id",
  );
  const pois: PoiSource[] = poiRows.filter((p) => p.dup === 1).map((p) => ({ osm: osmName(p.osm), name: p.name, kind: p.kind, district: p.district, province: provinceName(plate) ?? plate, lng: p.lon / 1e6, lat: p.lat / 1e6 }));
  return { rows, pois, districts: region.districts.length };
}

async function main(): Promise<void> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const out = join(repoRoot, 'fixtures', 'address-golden');
  mkdirSync(out, { recursive: true });
  for (const plate of PRIORITY) {
    const db = await store.open(plate);
    if (!db) throw new Error(`${plate}: paket yok`);
    const { rows, pois, districts } = await sourcesOf(db, plate);
    const queries = buildQueries(rows, pois, plate, 2026);
    writeFileSync(join(out, `${plate}.json`), JSON.stringify({ version: 1, plate, queries }, null, 1) + '\n');
    console.log(plate, queries.length, districts);
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
