import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { openRegion } from '../src/core/address/pack';
import { reverseDetailed } from '../src/core/address/reverse';
import { reverseOracle, type OracleAnswer } from '../test/address/oracle';
import { createSearch, type Search } from '../src/core/address/search';
import type { Place, ResolveResult } from '../src/core/address/types';
import { createBorders } from '../src/core/region/borders';
import type { PackStore, SqlDb } from '../src/core/ports';
import { provinceName } from '../src/core/text/admin';
import { numberAsWords } from '../src/core/text/digits';
import { streetKey } from '../src/core/text/street';
import { createNodePackStore } from '../src/node/pack-store';
import { rngOf, type GoldenQuery } from './build-address-golden';

export type Stats = { total: number; first: number; top5: number };
export type ExpectedAddress = { osmRows: { id: number; lng: number; lat: number }[]; number: string; streetName: string };

export function rankOf(result: ResolveResult, matches: (place: Place) => boolean): number | null {
  if (result.status === 'region_missing') return null;
  const index = result.candidates.findIndex(matches);
  return index < 0 ? null : index + 1;
}

export function summarize(ranks: (number | null)[]): Stats {
  return { total: ranks.length, first: ranks.filter((r) => r === 1).length, top5: ranks.filter((r) => r !== null && r <= 5).length };
}

export const withinRank = (ranks: (number | null)[], limit: number): number => ranks.filter((r) => r !== null && r <= limit).length;

export function isPlaceMatch(place: Place, plate: string, ids: number[]): boolean {
  const parts = place.id.split(':');
  return place.precision === 'poi' && parts[0] === plate && parts[1] === 'o' && ids.includes(Number(parts[2]));
}

export function offsetPoint(start: LngLat, meters: number, angle: number): LngLat {
  const dLat = (meters * Math.cos(angle)) / 111_195;
  const dLon = (meters * Math.sin(angle)) / (111_195 * Math.cos(((start[1] + dLat / 2) * Math.PI) / 180));
  return meters === 0 ? [start[0], start[1]] : [start[0] + dLon, start[1] + dLat];
}

export const sameAnswer = (a: OracleAnswer | null, b: OracleAnswer | null): boolean =>
  a === null || b === null ? a === b : a.plate === b.plate && a.districtId === b.districtId && a.hoodId === b.hoodId && a.addressId === b.addressId && a.streetId === b.streetId;

export function verdict(stats: Stats, firstMin: number, top5Min: number | null): boolean {
  if (stats.total === 0) return false;
  return stats.first * 100 >= firstMin * stats.total && (top5Min === null || stats.top5 * 100 >= top5Min * stats.total);
}

export function isAddressMatch(place: Place, plate: string, expected: ExpectedAddress): boolean {
  const parts = place.id.split(':');
  if (parts[0] !== plate || parts[1] !== 'a') return false;
  if (expected.osmRows.some((r) => r.id === Number(parts[2]))) return true;
  if (place.components.houseNumber !== expected.number || place.components.street !== expected.streetName) return false;
  return expected.osmRows.some((r) => distanceM(place.coordinate, [r.lng, r.lat]) <= 30);
}

function spellsNumber(name: string, queried: number): boolean {
  const key = streetKey(name).key;
  return numberAsWords(queried).some((w) => key === w || key.replace(/ /g, '') === w.replace(/ /g, ''));
}

export function checkNumbered(result: ResolveResult, queried: number, namesOf: (place: Place) => string[] = (p) => [p.components.street ?? '']): string[] {
  if (result.status === 'region_missing') return [];
  const wrong = new Set<string>();
  for (const c of result.candidates) {
    if (c.precision !== 'address' && c.precision !== 'interpolated' && c.precision !== 'street') continue;
    if (!namesOf(c).some((name) => streetKey(name).numbers.includes(String(queried)) || spellsNumber(name, queried))) wrong.add(c.components.street ?? '');
  }
  return [...wrong];
}

export const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const PRIORITY = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];
const REVERSE_POINTS = 10_000;
const CODE: Record<string, number> = { n: 0, w: 1, r: 2 };

export const goldenOf = (plate: string): GoldenQuery[] => (JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'address-golden', `${plate}.json`), 'utf8')) as { queries: GoldenQuery[] }).queries;
export const codeOf = (osm: string): number => Number(osm.slice(1)) * 4 + (CODE[osm[0] as string] as number);

async function expectedOf(db: SqlDb, q: GoldenQuery): Promise<ExpectedAddress> {
  const rows = await db.all<{ id: number; lon: number; lat: number }>('SELECT id, lon, lat FROM address WHERE osm = ? AND number = ?', [codeOf(q.expect.osm), q.expect.number as string]);
  return { osmRows: rows.map((r) => ({ id: r.id, lng: r.lon / 1e6, lat: r.lat / 1e6 })), number: q.expect.number as string, streetName: q.expect.streetName as string };
}

export async function streetNamesOf(db: SqlDb, place: Place): Promise<string[]> {
  const [, kind, id] = place.id.split(':');
  let ref: number | null = null;
  if (kind === 'a') ref = (await db.all<{ street_id: number | null }>('SELECT street_id FROM address WHERE id = ?', [Number(id)]))[0]?.street_id ?? null;
  else if (kind === 's' || kind === 'g' || kind === 'l') ref = Number(id);
  if (ref === null) return [place.components.street ?? ''];
  const names = await db.all<{ name: string }>('SELECT name FROM street_name WHERE id = ? UNION SELECT key FROM search_name WHERE kind = 0 AND ref = ?', [ref, ref]);
  return names.map((n) => n.name);
}

export type Measured = { check: string; pass: boolean; measured: string; report: string };

type Failure = { q: GoldenQuery; rank: number | null; status: string };

async function rankGolden(search: Search, db: SqlDb, plate: string, queries: GoldenQuery[]): Promise<{ ranks: (number | null)[]; failures: Failure[] }> {
  const ranks: (number | null)[] = [];
  const failures: Failure[] = [];
  for (const q of queries) {
    const expected = await expectedOf(db, q);
    const result = await search.resolve(q.text);
    const rank = rankOf(result, (p) => isAddressMatch(p, plate, expected));
    ranks.push(rank);
    if (rank !== 1) failures.push({ q, rank, status: result.status });
  }
  return { ranks, failures };
}

const describeFailure = ({ q, rank, status }: Failure): string => `${q.id} sıra=${rank ?? 'yok'} durum=${status} metin=${q.text} beklenen=${q.expect.osm}#${q.expect.number}`;
const percentOf = (part: number, whole: number): string => (whole === 0 ? '0' : ((part / whole) * 100).toFixed(2));

export async function openGolden(options: { directory?: boolean } = {}): Promise<{ store: PackStore; search: Search }> {
  const full = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const store: PackStore = options.directory === false ? { installed: full.installed, open: full.open } : full;
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  return { store, search: createSearch({ store, borders }) };
}

export async function measureCategory(check: 'full' | 'folded' | 'typo', limits: { first: number; top5: number | null }): Promise<Measured> {
  const { store, search } = await openGolden();
  const total: (number | null)[] = [];
  const lines = [`# Doğruluk: ${check}`, '', '| İl | Sorgu | İlk sırada | İlk 5te |', '|---|---|---|---|'];
  const failures: string[] = [];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const done = await rankGolden(search, db, plate, goldenOf(plate).filter((x) => x.category === check && !x.conflict));
    failures.push(...done.failures.map(describeFailure));
    const s = summarize(done.ranks);
    lines.push(`| ${plate} | ${s.total} | ${s.first} | ${s.top5} |`);
    total.push(...done.ranks);
    await db.close();
  }
  const stats = summarize(total);
  const pass = verdict(stats, limits.first, limits.top5);
  lines.push('', `Toplam ${stats.total}: ilk sırada yüzde ${percentOf(stats.first, stats.total)}, ilk 5te yüzde ${percentOf(stats.top5, stats.total)}.`, '', '## Hatalı ilk 60', '', ...failures.slice(0, 60).map((f) => `- ${f}`));
  return { check, pass, measured: `${stats.first}/${stats.total} ilk sırada (yüzde ${percentOf(stats.first, stats.total)}), ilk 5te yüzde ${percentOf(stats.top5, stats.total)}`, report: lines.join('\n') + '\n' };
}

async function arabicPlaces(store: PackStore, search: Search): Promise<{ total: number; first: number; top3: number }> {
  const db = (await store.open('34')) as SqlDb;
  const rows = await db.all<{ name: string; ref: number }>("SELECT name, ref FROM search_name WHERE lang = 'ar' AND kind = 1 AND name IS NOT NULL ORDER BY id");
  const step = Math.max(1, Math.floor(rows.length / ARABIC_SAMPLE));
  const ranks: (number | null)[] = [];
  for (let i = 0; i < rows.length && ranks.length < ARABIC_SAMPLE; i += step) {
    const row = rows[i] as { name: string; ref: number };
    ranks.push(rankOf(await search.resolve(row.name, { hints: { city: 'İstanbul' } }), (p) => isPlaceMatch(p, '34', [row.ref])));
  }
  await db.close();
  return { total: ranks.length, first: ranks.filter((r) => r === 1).length, top3: withinRank(ranks, 3) };
}

const ARABIC_SAMPLE = 100;
const LANGUAGE_LIMITS: Record<string, { first: number; top5: number | null }> = { en: { first: 95, top5: null }, de: { first: 95, top5: null }, ru: { first: 0, top5: 85 }, el: { first: 0, top5: 85 }, ar: { first: 90, top5: null } };
const MIN_LANGUAGE_QUERIES = 60;

export async function measureLanguages(): Promise<Measured> {
  const { store, search } = await openGolden();
  const byLang = new Map<string, (number | null)[]>();
  const failures = new Map<string, string[]>();
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const queries = goldenOf(plate).filter((x) => x.category === 'lang' && !x.conflict);
    for (const lang of Object.keys(LANGUAGE_LIMITS)) {
      const done = await rankGolden(search, db, plate, queries.filter((q) => q.lang === lang));
      byLang.set(lang, [...(byLang.get(lang) ?? []), ...done.ranks]);
      failures.set(lang, [...(failures.get(lang) ?? []), ...done.failures.map(describeFailure)]);
    }
    await db.close();
  }
  const lines = ['# Doğruluk: diller (K3.9)', '', '| Dil | Sorgu | İlk sırada | İlk 5te | Eşik | Sonuç |', '|---|---|---|---|---|---|'];
  let pass = true;
  const parts: string[] = [];
  for (const [lang, limit] of Object.entries(LANGUAGE_LIMITS)) {
    const stats = summarize(byLang.get(lang) ?? []);
    const ok = stats.total >= MIN_LANGUAGE_QUERIES && verdict(stats, limit.first, limit.top5);
    pass = pass && ok;
    const rule = limit.top5 !== null ? `ilk 5te en az ${limit.top5}` : `ilk sırada en az ${limit.first}`;
    lines.push(`| ${lang} | ${stats.total} | ${percentOf(stats.first, stats.total)} | ${percentOf(stats.top5, stats.total)} | ${rule} | ${ok ? 'geçti' : 'kaldı'} |`);
    parts.push(`${lang} ${limit.top5 !== null ? percentOf(stats.top5, stats.total) + ' (ilk5)' : percentOf(stats.first, stats.total)}`);
  }
  const arabic = await arabicPlaces(store, search);
  lines.push('', `Tamamen Arap harfli yer adları (yalnızca rapor, İstanbul'dan ${arabic.total} örnek): ilk 3te ${arabic.top3}, ilk sırada ${arabic.first}.`);
  for (const [lang, list] of failures) lines.push('', `## Hatalı ilk 25: ${lang}`, '', ...list.slice(0, 25).map((f) => `- ${f}`));
  return { check: 'languages', pass, measured: parts.join(', '), report: lines.join('\n') + '\n' };
}

export async function measureNumbered(): Promise<Measured> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const search = createSearch({ store, borders });
  let asked = 0;
  const violations: string[] = [];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const listing = store.openPart ? await store.openPart(plate, 'directory') : null;
    const numbers = (await db.all<{ number: number }>('SELECT DISTINCT number FROM street_name WHERE number IS NOT NULL ORDER BY number')).map((r) => r.number);
    const queries: { text: string; asked: number }[] = [];
    for (const n of numbers) for (const other of [n - 1, n + 1]) if (other > 0) queries.push({ text: `${other}. Sokak No: 1`, asked: other }, { text: `${other} sk`, asked: other });
    for (const q of goldenOf(plate).filter((x) => x.category === 'numbered')) queries.push({ text: q.text, asked: q.expect.streetNumber as number });
    for (const q of queries) {
      asked += 1;
      const result = await search.resolve(q.text, { hints: { city: provinceName(plate) ?? plate } });
      const names = new Map<Place, string[]>();
      if (result.status !== 'region_missing') for (const c of result.candidates) names.set(c, await streetNamesOf(c.id.split(':')[0]?.endsWith('+') && listing ? listing : db, c));
      const wrong = checkNumbered(result, q.asked, (place) => names.get(place) ?? []);
      if (wrong.length > 0) violations.push(`${plate} "${q.text}" -> ${wrong.join(', ')}`);
    }
    await db.close();
    await listing?.close();
  }
  const report = ['# Doğruluk: numaralı sokaklar', '', `${asked} sorguda sayısı tutmayan sokak dönen: ${violations.length}`, '', ...violations.slice(0, 60).map((v) => `- ${v}`)].join('\n') + '\n';
  return { check: 'numbered', pass: violations.length === 0 && asked > 0, measured: `${asked} sorguda sayısı tutmayan sokak ${violations.length} kez döndü`, report };
}

export async function measurePlaces(): Promise<Measured> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const search = createSearch({ store, borders });
  const total: (number | null)[] = [];
  const lines = ['# Doğruluk: yer arama', '', '| İl | Yer | İlk 3te |', '|---|---|---|'];
  const failures: string[] = [];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const ranks: (number | null)[] = [];
    for (const q of goldenOf(plate).filter((x) => x.category === 'poi')) {
      const ids = (await db.all<{ id: number }>('SELECT id FROM poi WHERE osm = ?', [codeOf(q.expect.osm)])).map((r) => r.id);
      const result = await search.resolve(q.text, { hints: { city: provinceName(plate) ?? plate } });
      const rank = rankOf(result, (p) => isPlaceMatch(p, plate, ids));
      ranks.push(rank);
      if (rank === null || rank > 3) failures.push(`${q.id} sıra=${rank ?? 'yok'} durum=${result.status} metin=${q.text} beklenen=${q.expect.streetName}`);
    }
    lines.push(`| ${plate} | ${ranks.length} | ${withinRank(ranks, 3)} |`);
    total.push(...ranks);
    await db.close();
  }
  const top3 = withinRank(total, 3);
  const pass = total.length >= 120 && top3 * 100 >= 95 * total.length;
  const percent = total.length === 0 ? '0' : ((top3 / total.length) * 100).toFixed(2);
  lines.push('', `Toplam ${total.length}: ilk 3te yüzde ${percent}.`, '', '## Hatalı olanlar', '', ...failures.slice(0, 60).map((f) => `- ${f}`));
  return { check: 'places', pass, measured: `${top3}/${total.length} ilk 3te (yüzde ${percent})`, report: lines.join('\n') + '\n' };
}

export async function measureReverse(): Promise<Measured> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const dbs = new Map<string, SqlDb>();
  const regions = [];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    dbs.set(plate, db);
    regions.push(await openRegion(db));
  }
  const lines = ['# Ters arama (K3.6)', '', '| İl | Nokta | Aynı |', '|---|---|---|'];
  const wrong: string[] = [];
  let total = 0;
  let same = 0;
  const kinds = new Map<string, number>();
  for (const [index, region] of regions.entries()) {
    const plate = region.id;
    const next = rngOf(2026 + Number(plate));
    const db = dbs.get(plate) as SqlDb;
    const bounds = borders.provinceBounds(plate) as [number, number, number, number];
    const ids = (await db.all<{ low: number; high: number }>('SELECT MIN(id) AS low, MAX(id) AS high FROM address'))[0] as { low: number; high: number };
    const count = Math.floor(REVERSE_POINTS / PRIORITY.length) + (index < REVERSE_POINTS % PRIORITY.length ? 1 : 0);
    let here = 0;
    let match = 0;
    for (let i = 0; i < count; i++) {
      let point: LngLat | null = null;
      if (i % 2 === 0) {
        const row = (await db.all<{ lon: number; lat: number }>('SELECT lon, lat FROM address WHERE id >= ? ORDER BY id LIMIT 1', [ids.low + Math.floor(next() * (ids.high - ids.low + 1))]))[0];
        if (row) point = offsetPoint([row.lon / 1e6, row.lat / 1e6], next() * 80, next() * 2 * Math.PI);
      } else {
        for (let tries = 0; tries < 200 && point === null; tries++) {
          const candidate: LngLat = [bounds[0] + next() * (bounds[2] - bounds[0]), bounds[1] + next() * (bounds[3] - bounds[1])];
          if (borders.provinceAt(candidate[0], candidate[1]) === plate) point = candidate;
        }
      }
      if (!point) continue;
      const found = await reverseDetailed(regions, borders, point);
      const slow = await reverseOracle(regions, borders, point);
      const answer: OracleAnswer | null = found ? { plate: found.plate, districtId: found.districtId, hoodId: found.hoodId, addressId: found.addressId, streetId: found.streetId } : null;
      here += 1;
      const kind = found ? found.place.precision : 'yok';
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      if (sameAnswer(answer, slow)) match += 1;
      else if (wrong.length < 60) wrong.push(`${plate} ${point[0].toFixed(6)},${point[1].toFixed(6)} hızlı=${JSON.stringify(answer)} kahin=${JSON.stringify(slow)}`);
    }
    lines.push(`| ${plate} | ${here} | ${match} |`);
    total += here;
    same += match;
  }
  for (const db of dbs.values()) await db.close();
  lines.push('', `Toplam ${total}: aynı ${same}.`, '', `Sonuç türleri: ${[...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`, '', '## Ayrışanlar', '', ...wrong.map((w) => `- ${w}`));
  return { check: 'reverse', pass: total >= REVERSE_POINTS && same === total, measured: `${same}/${total} nokta kahinle aynı (${[...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', ')})`, report: lines.join('\n') + '\n' };
}

export async function runCheck(check: string): Promise<Measured | null> {
  switch (check) {
    case 'full':
      return measureCategory('full', { first: 99, top5: null });
    case 'folded':
      return measureCategory('folded', { first: 98, top5: null });
    case 'typo':
      return measureCategory('typo', { first: 90, top5: 97 });
    case 'numbered':
      return measureNumbered();
    case 'places':
      return measurePlaces();
    case 'reverse':
      return measureReverse();
    case 'languages':
      return measureLanguages();
    case 'predict':
      return (await import('./measure-quality')).measurePredict();
    case 'label':
      return (await import('./measure-quality')).measureLabel();
    case 'oracle':
      return (await import('./measure-quality')).measureOracle();
    case 'speed':
      return (await import('./measure-quality')).measureSpeed(false);
    case 'speed-directory':
      return (await import('./measure-quality')).measureSpeed(true);
    case 'regions-all':
      return (await import('./measure-quality')).measureRegionsAll();
    case 'fuzz':
      return (await import('./measure-quality')).measureFuzz();
    default:
      return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check full|folded|typo|numbered|places|reverse|languages|predict|label|oracle|speed|speed-directory|fuzz|regions-all');
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-3-dogruluk-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
