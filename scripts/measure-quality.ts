import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openBuildings } from '../src/core/address/buildings';
import { nameScore } from '../src/core/address/names';
import { openRegion } from '../src/core/address/pack';
import { predictNumber } from '../src/core/address/predict';
import { MIN_NAME } from '../src/core/address/resolve';
import { createSearch, type Search } from '../src/core/address/search';
import type { Place, ResolveResult } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import type { PackStore, SqlDb } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { provinceName } from '../src/core/text/admin';
import { parseAddress } from '../src/core/text/parse';
import { streetKey } from '../src/core/text/street';
import { createNodePackStore } from '../src/node/pack-store';
import { openSqlite } from '../src/node/sqlite';
import { linearBaseline } from '../test/reference/linear';
import { noisyStreet, rngOf, type Rng } from './build-address-golden';
import { NUMBER, isCleanStreet } from './build-address-records';
import { PRIORITY, codeOf, goldenOf, isAddressMatch, openGolden, rankOf, repoRoot, type Measured } from './measure-address';
import { pickTargets, summarize, type AddressPoint, type Stats } from './measure-predict';

const POOLED_MEDIAN_MAX = 20;
const SPEED_LIMITS = { resolve: 15, autocomplete: 10 };
const DIRECTORY_SPEED_LIMITS = { resolve: 25, autocomplete: 10 };
const LABEL_QUERIES = 100_000;
const FUZZ_INPUTS = 100_000;
const ORACLE_QUERIES = 5_000;
const SPEED_QUERIES = 2_000;
const WARM = 200;

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number;
}

export function predictVerdict(rows: { plate: string; mine: Stats; base: Stats }[], pooledMedian: number): { pass: boolean; worse: string[] } {
  const worse = rows.filter((r) => r.mine.median > r.base.median || r.mine.p90 > r.base.p90).map((r) => r.plate);
  return { pass: rows.length > 0 && worse.length === 0 && pooledMedian <= POOLED_MEDIAN_MAX, worse };
}

export function labelProblem(place: Place, row: { number: string; lng: number; lat: number } | null): string | null {
  if (place.precision === 'poi') return place.approximate ? 'approximate true ama yer' : null;
  if (place.precision !== 'address') return place.approximate ? null : `approximate false ama ${place.precision}`;
  if (place.approximate) return 'approximate true ama adres';
  if (!['osm', 'correction', 'learned'].includes(place.source)) return `kaynak ${place.source} gerçek nokta değil`;
  if (row === null) return 'adres satırı yok';
  if (row.number !== place.components.houseNumber) return `numara satırdakiyle aynı değil (${place.components.houseNumber} / ${row.number})`;
  if (place.source === 'osm' && distanceM(place.coordinate, [row.lng, row.lat]) > 0.5) return 'nokta satırdakiyle aynı değil';
  return null;
}

export function topStreet(scores: Map<number, number>): number | null {
  let best: number | null = null;
  for (const [ref, score] of scores) {
    const current = best === null ? -1 : (scores.get(best) as number);
    if (best === null || score > current || (score === current && ref < best)) best = ref;
  }
  return best;
}

export function classifyOracle(indexed: Map<number, number>, slow: Map<number, number>): 'same' | 'below' | 'limit' | 'score' {
  const a = topStreet(indexed);
  const b = topStreet(slow);
  if (a === b) return 'same';
  const best = b === null ? 0 : (slow.get(b) as number);
  if (best < MIN_NAME) return 'below';
  if (a !== null && indexed.get(a) === best) return 'same';
  if (b !== null && !indexed.has(b)) return 'limit';
  return 'score';
}

export type RegionRow = { plate: string; opened: boolean; asked: number; right: number; thrown: number };

export function regionsAllVerdict(rows: RegionRow[]): { pass: boolean; bad: string[] } {
  const bad = rows.filter((r) => !r.opened || r.thrown > 0 || r.right * 100 < 95 * r.asked).map((r) => r.plate);
  return { pass: rows.length > 0 && bad.length === 0, bad };
}

const VOWELS = /[aeıioöuüAEIİOÖUÜ]/g;
const NOISE = ['no', 'kat 3', 'xx', 'daire 2', 'mah', 'sk', '#'];

export function mutate(text: string, next: Rng): string {
  const pos = (): number => Math.floor(next() * Math.max(1, text.length));
  const words = text.split(' ');
  switch (Math.floor(next() * 10)) {
    case 0:
      return text.slice(0, pos()) + text.slice(pos() + 1);
    case 1: {
      const i = pos();
      return text.slice(0, i) + (text[i + 1] ?? '') + (text[i] ?? '') + text.slice(i + 2);
    }
    case 2:
      return text.replace(/\d/, String(Math.floor(next() * 10)));
    case 3:
      return text.toUpperCase();
    case 4: {
      const w = Math.floor(next() * words.length);
      return words.map((x, i) => (i === w ? x.replace(VOWELS, '') : x)).join(' ');
    }
    case 5: {
      const i = pos();
      return text.slice(0, i) + (text[i] ?? '') + text.slice(i);
    }
    case 6:
      return words.filter((_, i) => i !== Math.floor(next() * words.length)).join(' ');
    case 7:
      return `${text} ${NOISE[Math.floor(next() * NOISE.length)]}`;
    case 8:
      return text.slice(0, Math.max(1, Math.floor(next() * text.length)));
    default:
      return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
  }
}

const SPECIAL = ["'; DROP TABLE address; --", '" OR 1=1 --', '%_%', '\\', '../../etc/passwd', '\0', '\ud800', '(((', '١٢٣٤٥', 'ǅ', 'İİİİ', 'No:-1', '1.2.3.4.5.6'];
const PIECES = ['😀', '🏠', '‮', '‭', '​', '‌', '‍', '\u0000', ' ', 'ا', 'ж', 'ω', 'bahariye', 'cd', 'no', '14', 'moda', 'mah', 'kadikoy', 'istanbul', '0', '9999999999'];

export function oddText(next: Rng): string {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  switch (Math.floor(next() * 9)) {
    case 0:
      return '';
    case 1:
      return ' '.repeat(1 + Math.floor(next() * 5)) + (next() < 0.5 ? '\n\t' : '');
    case 2:
      return pick(SPECIAL);
    case 3:
      return Array.from({ length: 1 + Math.floor(next() * 10) }, () => pick(PIECES)).join(next() < 0.5 ? ' ' : '');
    case 4:
      return Array.from({ length: 1000 + Math.floor(next() * 4500) }, () => pick(['a', 'b', ' ', '1', 'ş', '-'])).join('');
    case 5:
      return Array.from({ length: Math.floor(next() * 30) }, () => String.fromCodePoint(32 + Math.floor(next() * 0x2fff))).join('');
    case 6:
      return String(Math.floor(next() * 1e12));
    case 7:
      return Array.from({ length: 1 + Math.floor(next() * 8) }, () => pick(['sk', 'cd', 'mah', 'no', 'kat', 'daire', 'blok'])).join(' ');
    default:
      return `${pick(PIECES)} ${Math.floor(next() * 1000)} ${pick(SPECIAL)}`;
  }
}

export function validPlace(p: Place): boolean {
  return typeof p.id === 'string' && p.id !== '' && typeof p.label === 'string' && Number.isFinite(p.coordinate[0]) && Number.isFinite(p.coordinate[1]) && p.confidence >= 0 && p.confidence <= 1 && typeof p.approximate === 'boolean';
}

const candidatesOf = (r: ResolveResult): Place[] => (r.status === 'region_missing' ? [] : r.candidates);
const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();
const packsDir = join(repoRoot, 'dist', 'packs');
const bordersOf = () => createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));

export async function measurePredict(): Promise<Measured> {
  const store = await createNodePackStore(packsDir);
  const rows: { plate: string; mine: Stats; base: Stats }[] = [];
  const all: number[] = [];
  const lines = ['# Numara tahmini (K3.5)', '', 'Her ilde iki yanında komşusu olan en çok 2.000 adres tek tek gizlenir. "Paket" sütunu, bina parçası kuruluysa çekmeyle (üretimdeki davranış), "Çekmesiz" yalnızca çizgi tahmini.', '', '| İl | Adet | Çekilen | Çekmesiz ortanca | Çekmesiz p90 | Paket ortanca | Paket p90 | Taban ortanca | Taban p90 | Tek yanlı ortanca | Komşusuz ortanca |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  let wrongFlag = 0;
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const region = await openRegion(db);
    const part = store.openPart ? await store.openPart(plate, 'buildings') : null;
    const snap = part ? await openBuildings(part, (cells) => region.addressesInCells(cells)) : undefined;
    const raw = await db.all<{ id: number; street_id: number; district_id: number; hood_id: number | null; num: number; parity: number; lon: number; lat: number }>('SELECT id, street_id, district_id, hood_id, num, parity, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND parity IS NOT NULL ORDER BY id');
    const points: AddressPoint[] = raw.map((r) => ({ id: r.id, streetId: r.street_id, districtId: r.district_id, hoodId: r.hood_id, num: r.num, parity: r.parity as 0 | 1, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
    const picked = pickTargets(points, 2000, 2026);
    const plain: number[] = [];
    const mine: number[] = [];
    const base: number[] = [];
    let moved = 0;
    for (const t of picked.both) {
      const truth: LngLat = [t.lng, t.lat];
      const street = { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId };
      const number = { int: t.num, key: String(t.num), parity: t.parity };
      const parts = await region.partsOf(t.streetId);
      const exclude = new Set([t.id]);
      const a = await predictNumber(region, street, number, { exclude, parts });
      const b = await predictNumber(region, street, number, { exclude, parts, snap });
      if (!a || !b || a.precision !== 'interpolated' || b.precision !== 'interpolated') {
        wrongFlag += 1;
        continue;
      }
      plain.push(distanceM(a.coordinate, truth));
      mine.push(distanceM(b.coordinate, truth));
      if (b.snapped) moved += 1;
      const neighbours = points.filter((r) => r.streetId === t.streetId && r.districtId === t.districtId && r.parity === t.parity && r.id !== t.id).map((r) => ({ int: r.num, point: [r.lng, r.lat] as LngLat }));
      const lower = neighbours.filter((n) => n.int < t.num).sort((x, y) => y.int - x.int)[0];
      const line = parts.flatMap((p) => p.lines).filter((l) => l.length >= 2).sort((x, y) => (lower ? distanceM(x[0] as LngLat, lower.point) - distanceM(y[0] as LngLat, lower.point) : 0))[0];
      const guess = line ? linearBaseline(neighbours, line, t.num) : null;
      if (guess) base.push(distanceM(guess, truth));
    }
    const one: number[] = [];
    for (const t of picked.oneSided) {
      const p = await predictNumber(region, { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId }, { int: t.num, key: String(t.num), parity: t.parity }, { exclude: new Set([t.id]), snap });
      if (p && p.precision === 'interpolated') one.push(distanceM(p.coordinate, [t.lng, t.lat]));
    }
    const alone: number[] = [];
    for (const t of picked.alone) {
      const p = await predictNumber(region, { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId }, { int: t.num, key: String(t.num), parity: t.parity }, { exclude: new Set([t.id]), snap });
      if (p) alone.push(distanceM(p.coordinate, [t.lng, t.lat]));
    }
    all.push(...mine);
    const sm = summarize(mine);
    const sb = summarize(base);
    rows.push({ plate, mine: sm, base: sb });
    const sp = summarize(plain);
    lines.push(`| ${plate} | ${mine.length} | ${moved} | ${sp.median} | ${sp.p90} | ${sm.median} | ${sm.p90} | ${sb.median} | ${sb.p90} | ${summarize(one).median} | ${summarize(alone).median} |`);
    await db.close();
    await part?.close();
  }
  const pooled = summarize(all).median;
  const verdict = predictVerdict(rows, pooled);
  const pass = verdict.pass && wrongFlag === 0;
  lines.push('', `12 il toplamı ortanca ${pooled} m (üst sınır ${POOLED_MEDIAN_MAX}). Tabandan kötü iller: ${verdict.worse.join(', ') || 'yok'}. Tahmin vermeyen ya da interpolated olmayan: ${wrongFlag}.`);
  return { check: 'predict', pass, measured: `toplam ortanca ${pooled} m, tabandan kötü il: ${verdict.worse.length}, tahmin vermeyen: ${wrongFlag}`, report: lines.join('\n') + '\n' };
}

function copyWithout(file: string, drop: { osm: string; number: string }[]): string {
  const copy = join(mkdtempSync(join(tmpdir(), 'hide-')), 'address.sqlite');
  copyFileSync(file, copy);
  const db = new DatabaseSync(copy);
  const del = db.prepare('DELETE FROM address WHERE osm = ? AND number = ?');
  for (const d of drop) del.run(codeOf(d.osm), d.number);
  db.close();
  return copy;
}

export async function measureLabel(): Promise<Measured> {
  const { store, search } = await openGolden();
  const borders = bordersOf();
  let asked = 0;
  let checked = 0;
  const problems: string[] = [];
  const next = rngOf(2026);
  const goldenTotal = PRIORITY.reduce((sum, plate) => sum + goldenOf(plate).length, 0);
  const perQuery = Math.max(1, Math.ceil((LABEL_QUERIES - goldenTotal) / Math.max(1, goldenTotal)));
  const lines = ['# Etiket doğruluğu (K3.7)', ''];
  const rowCache = new Map<string, { number: string; lng: number; lat: number } | null>();
  const dbs = new Map<string, SqlDb>();
  const dbOf = async (plate: string): Promise<SqlDb> => {
    let db = dbs.get(plate);
    if (!db) dbs.set(plate, (db = (await store.open(plate)) as SqlDb));
    return db;
  };
  const check = async (text: string, via: Search): Promise<void> => {
    asked += 1;
    const result = await via.resolve(text);
    for (const candidate of candidatesOf(result)) {
      checked += 1;
      let row = null;
      if (candidate.precision === 'address') {
        const [plate, , id] = candidate.id.split(':');
        const key = `${plate}:${id}`;
        if (!rowCache.has(key)) {
          const found = (await (await dbOf(plate as string)).all<{ number: string; lon: number; lat: number }>('SELECT number, lon, lat FROM address WHERE id = ?', [Number(id)]))[0];
          rowCache.set(key, found ? { number: found.number, lng: found.lon / 1e6, lat: found.lat / 1e6 } : null);
        }
        row = rowCache.get(key) ?? null;
      }
      const problem = labelProblem(candidate, row);
      if (problem && problems.length < 60) problems.push(`"${text.slice(0, 80)}" -> ${candidate.id} ${problem}`);
      else if (problem) problems.push('');
    }
  };
  for (const plate of PRIORITY) {
    for (const q of goldenOf(plate).filter((x) => x.category !== 'hide')) {
      await check(q.text, search);
      for (let i = 0; i < perQuery; i++) await check(mutate(q.text, next), search);
    }
  }
  let hidden = 0;
  for (const plate of PRIORITY) {
    const queries = goldenOf(plate).filter((x) => x.category === 'hide');
    const manifest = JSON.parse(readFileSync(join(packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; path: string }[] }[] };
    const file = join(packsDir, (manifest.regions.find((r) => r.id === plate)?.files.find((f) => f.kind === 'address') as { path: string }).path);
    const copy = copyWithout(file, queries.map((q) => ({ osm: q.expect.osm, number: q.expect.number as string })));
    const db = openSqlite(copy);
    dbs.set(plate, db);
    rowCache.clear();
    const single: PackStore = { installed: async () => [plate], open: async () => openSqlite(copy) };
    const via = createSearch({ store: single, borders });
    for (const q of queries) {
      hidden += 1;
      await check(q.text, via);
      for (let i = 0; i < perQuery; i++) await check(mutate(q.text, next), via);
    }
    await db.close();
    dbs.delete(plate);
  }
  for (const db of dbs.values()) await db.close();
  const count = problems.length;
  lines.push(`${asked} sorgu (altın kümeler, bozulmuş biçimleri ve ${hidden} gizlenmiş adres), ${checked} sonuç denetlendi; ihlal: ${count}.`, '', ...problems.filter((p) => p !== '').map((p) => `- ${p}`));
  return { check: 'label', pass: count === 0 && asked >= LABEL_QUERIES, measured: `${asked} sorgu, ${checked} sonuç, ihlal ${count}`, report: lines.join('\n') + '\n' };
}

export async function measureOracle(): Promise<Measured> {
  const store = await createNodePackStore(packsDir);
  const next = rngOf(2027);
  let asked = 0;
  let same = 0;
  let limited = 0;
  let below = 0;
  const diffs: string[] = [];
  const perPlate = Math.ceil(ORACLE_QUERIES / PRIORITY.length);
  const lines = ['# Dizinli arama ve kahin (K3.10)', ''];
  for (const plate of PRIORITY) {
    const db = (await store.open(plate)) as SqlDb;
    const region = await openRegion(db);
    const names = await region.allNames('street');
    const keys = new Map<string, ReturnType<typeof streetKey>>();
    const keyOf = (key: string): ReturnType<typeof streetKey> => {
      let k = keys.get(key);
      if (!k) keys.set(key, (k = streetKey(key)));
      return k;
    };
    const source = goldenOf(plate).filter((q) => ['full', 'folded', 'typo', 'numbered'].includes(q.category));
    for (let i = 0; i < perPlate; i++) {
      const base = source[i % source.length] as (typeof source)[number];
      const text = i < source.length ? base.text : mutate(base.text, next);
      const parsed = parseAddress(text);
      if (!parsed.street) continue;
      const asked_ = streetKey(parsed.street.text);
      const query = { ...asked_, kind: parsed.street.kind ?? asked_.kind };
      const indexed = new Map<number, number>();
      for (const c of await region.streetCandidates(query.key, 'street')) indexed.set(c.ref, Math.max(indexed.get(c.ref) ?? 0, nameScore(query, keyOf(c.key)).score));
      const slow = new Map<number, number>();
      for (const n of names) slow.set(n.ref, Math.max(slow.get(n.ref) ?? 0, nameScore(query, keyOf(n.key)).score));
      asked += 1;
      const kind = classifyOracle(indexed, slow);
      if (kind === 'same') same += 1;
      else if (kind === 'below') below += 1;
      else {
        if (kind === 'limit') limited += 1;
        const a = topStreet(indexed);
        const b = topStreet(slow);
        if (diffs.length < 40) diffs.push(`${plate} "${text.slice(0, 70)}" ${kind} dizinli=${a} (${a === null ? '-' : fmt(indexed.get(a) as number)}) kahin=${b} (${b === null ? '-' : fmt(slow.get(b) as number)})`);
      }
    }
    await db.close();
  }
  lines.push(`${asked} sorguda ilk sonuç aynı: ${same}; kahinin en iyi puanı ${MIN_NAME} altında olduğu için sonuçta görünmeyecek fark: ${below}; görünür fark: ${asked - same - below} (aday sınırı yüzünden: ${limited}).`, '', ...diffs.map((d) => `- ${d}`));
  return { check: 'oracle', pass: asked >= ORACLE_QUERIES - PRIORITY.length * 30 && same + below === asked, measured: `${same}/${asked} aynı, eşik altı ${below}, görünür fark ${asked - same - below} (aday sınırı ${limited})`, report: lines.join('\n') + '\n' };
}

export async function measureSpeed(withDirectory = false): Promise<Measured> {
  const limits = withDirectory ? DIRECTORY_SPEED_LIMITS : SPEED_LIMITS;
  const { search } = await openGolden({ directory: withDirectory });
  const next = rngOf(2028);
  const golden = goldenOf('34');
  const texts = Array.from({ length: SPEED_QUERIES + WARM }, (_, i) => (i < golden.length ? (golden[i] as (typeof golden)[number]).text : mutate((golden[i % golden.length] as (typeof golden)[number]).text, next)));
  const streets = golden.map((q) => (q.expect.streetName ?? '').split(' ')[0] ?? '').filter((w) => w.length >= 4);
  const prefixes = Array.from({ length: SPEED_QUERIES + WARM }, (_, i) => {
    const word = streets[i % streets.length] as string;
    return word.slice(0, 3 + Math.floor(next() * Math.min(4, word.length - 2)));
  });
  const time = async (list: string[], run: (t: string) => Promise<unknown>): Promise<number[]> => {
    const out: number[] = [];
    for (const [i, t] of list.entries()) {
      const start = performance.now();
      await run(t);
      if (i >= WARM) out.push(performance.now() - start);
    }
    return out.sort((a, b) => a - b);
  };
  const resolveTimes = await time(texts, (t) => search.resolve(t));
  const suggestTimes = await time(prefixes, (t) => search.autocomplete(t));
  const row = (name: string, v: number[]): string => `| ${name} | ${v.length} | ${fmt(percentile(v, 0.5))} | ${fmt(percentile(v, 0.95))} | ${fmt(percentile(v, 0.99))} | ${fmt(v[v.length - 1] ?? 0)} |`;
  const r95 = percentile(resolveTimes, 0.95);
  const a95 = percentile(suggestTimes, 0.95);
  const lines = [withDirectory ? '# Hız (K5.9d), İstanbul adres paketi ve rehber, Node, bu Mac' : '# Hız (K3.11), İstanbul adres paketi, Node, bu Mac', '', '| İşlem | Adet | p50 ms | p95 ms | p99 ms | en çok ms |', '|---|---|---|---|---|---|', row('resolve', resolveTimes), row('autocomplete', suggestTimes), '', `Eşikler: resolve p95 en çok ${limits.resolve} ms, autocomplete p95 en çok ${limits.autocomplete} ms.`];
  return { check: withDirectory ? 'speed-directory' : 'speed', pass: r95 <= limits.resolve && a95 <= limits.autocomplete, measured: `resolve p95 ${fmt(r95)} ms, autocomplete p95 ${fmt(a95)} ms`, report: lines.join('\n') + '\n' };
}

export async function measureFuzz(): Promise<Measured> {
  const { search } = await openGolden();
  const next = rngOf(2029);
  const golden = PRIORITY.flatMap((plate) => goldenOf(plate).map((q) => q.text));
  let thrown = 0;
  let invalid = 0;
  const samples: string[] = [];
  for (let i = 0; i < FUZZ_INPUTS; i++) {
    const text = next() < 0.8 ? oddText(next) : mutate(golden[Math.floor(next() * golden.length)] as string, next);
    const kind = next();
    try {
      if (kind < 0.5) {
        const result = await search.resolve(text, next() < 0.2 ? { limit: Math.floor(next() * 12) - 2, hints: { city: 'İstanbul' } } : {});
        if (!['resolved', 'ambiguous', 'not_found', 'region_missing'].includes(result.status) || !candidatesOf(result).every(validPlace)) invalid += 1;
      } else if (kind < 0.8) {
        if (!(await search.autocomplete(text)).every(validPlace)) invalid += 1;
      } else {
        const point: LngLat = [25 + next() * 21 + (next() < 0.05 ? Number.NaN : 0), 35 + next() * 8 + (next() < 0.05 ? Infinity : 0)];
        const place = await search.reverse(point);
        if (place && !validPlace(place)) invalid += 1;
      }
    } catch (error) {
      thrown += 1;
      if (samples.length < 20) samples.push(`${JSON.stringify(text.slice(0, 60))}: ${String(error).slice(0, 120)}`);
    }
  }
  const lines = ['# Bozuk girdi (K3.12)', '', `${FUZZ_INPUTS} girdi: hata fırlatan ${thrown}, geçersiz biçimli sonuç ${invalid}.`, '', ...samples.map((s) => `- ${s}`)];
  return { check: 'fuzz', pass: thrown === 0 && invalid === 0, measured: `${FUZZ_INPUTS} girdi, hata ${thrown}, geçersiz ${invalid}`, report: lines.join('\n') + '\n' };
}

const provinceLabel = (plate: string): string => provinceName(plate) ?? plate;
const SAMPLE_ROWS = 20;
const ODD_PER_PACK = 200;

export async function measureRegionsAll(): Promise<Measured> {
  const { store, search } = await openGolden();
  const next = rngOf(2030);
  const rows: RegionRow[] = [];
  const lines = ['# 81 ilin paketi (K3.14)', '', '| İl | Açıldı | Örnek | Doğru | Hata |', '|---|---|---|---|---|'];
  for (const plate of await store.installed()) {
    const db = await store.open(plate);
    const row: RegionRow = { plate, opened: db !== null, asked: 0, right: 0, thrown: 0 };
    if (db) {
      try {
        const total = (await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM address WHERE street_id IS NOT NULL AND hood_id IS NOT NULL'))[0]?.n ?? 0;
        if (total >= SAMPLE_ROWS) {
          const step = Math.max(1, Math.floor(total / (SAMPLE_ROWS * 20)));
          const found = await db.all<{ id: number; street_id: number; nkey: string; number: string; lon: number; lat: number; street: string; hood: string; district: string }>(
            'SELECT a.id, a.street_id, a.nkey, a.number, a.lon, a.lat, s.name AS street, h.name AS hood, d.name AS district FROM address a JOIN street_name s ON s.id = a.street_id JOIN neighbourhood h ON h.id = a.hood_id JOIN district d ON d.id = a.district_id WHERE a.street_id IS NOT NULL AND a.hood_id IS NOT NULL AND a.id % ? = 0 ORDER BY a.id LIMIT ?',
            [step, SAMPLE_ROWS * 20],
          );
          const picked: typeof found = [];
          for (const r of found) {
            if (picked.length >= SAMPLE_ROWS) break;
            if (!NUMBER.test(r.number) || !isCleanStreet(r.street) || noisyStreet(r.street)) continue;
            const same = (await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM address WHERE street_id = ? AND nkey = ?', [r.street_id, r.nkey]))[0]?.n ?? 0;
            if (same === 1) picked.push(r);
          }
          for (const r of picked) {
            row.asked += 1;
            try {
              const result = await search.resolve(`${r.hood} mah ${r.street} no ${r.number} ${r.district} ${provinceLabel(plate)}`);
              const expected = { osmRows: [{ id: r.id, lng: r.lon / 1e6, lat: r.lat / 1e6 }], number: r.number, streetName: r.street };
              if (rankOf(result, (p) => isAddressMatch(p, plate, expected)) === 1) row.right += 1;
            } catch {
              row.thrown += 1;
            }
          }
        }
        for (let i = 0; i < ODD_PER_PACK; i++) {
          try {
            await search.resolve(oddText(next), { hints: { city: provinceLabel(plate) } });
          } catch {
            row.thrown += 1;
          }
        }
      } finally {
        await db.close();
      }
    }
    rows.push(row);
    lines.push(`| ${plate} | ${row.opened ? 'evet' : 'hayır'} | ${row.asked} | ${row.right} | ${row.thrown} |`);
  }
  const verdict = regionsAllVerdict(rows);
  lines.push('', `${rows.length} paket; sorunlu: ${verdict.bad.join(', ') || 'yok'}.`);
  return { check: 'regions-all', pass: verdict.pass && rows.length === 81, measured: `${rows.length} paket, sorunlu ${verdict.bad.length}`, report: lines.join('\n') + '\n' };
}
