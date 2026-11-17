import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { openRegion } from '../src/core/address/pack';
import { predictNumber } from '../src/core/address/predict';
import { createSearch, type Search } from '../src/core/address/search';
import type { Place } from '../src/core/address/types';
import { createBorders } from '../src/core/region/borders';
import { nameKey, parseAddress } from '../src/core/text';
import { streetKey } from '../src/core/text/street';
import { createNodePackStore } from '../src/node/pack-store';
import { openSqlite } from '../src/node/sqlite';
import { DATA_VERSION, packsDir, pick, plates, readSet, repoRoot, seeded, setsDir, type Door, type TextRecord } from './addr-sets';
import type { PlaceRecord } from './addr-g7g8';

export type Stats = { count: number; median: number; p90: number; p99: number; within15: number; within30: number; within50: number };

export function stats(errors: number[]): Stats {
  const sorted = [...errors].sort((a, b) => a - b);
  const at = (q: number): number => (sorted.length === 0 ? 0 : Math.round((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number) * 10) / 10);
  const share = (limit: number): number => (sorted.length === 0 ? 0 : Math.round((1000 * sorted.filter((e) => e <= limit).length) / sorted.length) / 10);
  return { count: sorted.length, median: at(0.5), p90: at(0.9), p99: at(0.99), within15: share(15), within30: share(30), within50: share(50) };
}

const NOT_FOUND = 100_000;

export type UnitCheck = { floor: boolean | null; door: boolean | null; block: boolean | null };
export type TextOutcome = { id: string; source: string; ops: string[]; status: string; precision: string | null; errorM: number; streetOk: boolean; hoodOk: boolean | null; districtOk: boolean; ms: number; unit?: UnitCheck };

const unitKey = (value: string | null | undefined): string => (value ?? '').toLocaleLowerCase('tr-TR').replace(/[^0-9a-zçğıöşü]/g, '');

export function checkUnit(record: TextRecord): UnitCheck | undefined {
  if (!record.unit) return undefined;
  const parsed = parseAddress(record.text);
  const same = (want: string | undefined, got: string | null): boolean | null => (want === undefined ? null : unitKey(got) === unitKey(want));
  return { floor: same(record.unit.floor, parsed.floor), door: same(record.unit.door, parsed.door), block: same(record.unit.block, parsed.block) };
}

export async function openSearch(version = DATA_VERSION, directory = true, only?: string[]): Promise<Search> {
  const release = await createNodePackStore(packsDir(version));
  const evalName = process.env.ADDR_PACKS;
  const evalDir = evalName ? join(repoRoot, 'dist', 'eval-packs', evalName) : null;
  const full = evalDir
    ? { ...release, installed: async () => readdirSync(evalDir).sort(), open: async (id: string) => (existsSync(join(evalDir, id, 'address.sqlite')) ? openSqlite(join(evalDir, id, 'address.sqlite')) : null) }
    : release;
  const installed = only ? async () => (await full.installed()).filter((id) => only.includes(id)) : full.installed;
  const build2 = process.env.BUILD2;
  const withBuildings = (base: typeof full): typeof full =>
    build2
      ? {
          ...base,
          openPart: async (id: string, kind: 'buildings' | 'directory' | 'buildings2') => {
            if (kind !== 'buildings2') return base.openPart ? base.openPart(id, kind) : null;
            const file = join(repoRoot, 'dist', 'eval-packs', build2, id, 'buildings2.sqlite');
            return existsSync(file) ? openSqlite(file) : null;
          },
        }
      : base;
  const store = withBuildings(directory ? { ...full, installed } : ({ installed, open: full.open } as typeof full));
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  return createSearch({ store, borders, maxOpen: 4 });
}

export async function evalText(search: Search, record: TextRecord, hint = false): Promise<TextOutcome> {
  const started = performance.now();
  const result = await search.resolve(record.text, hint ? { hints: { city: record.province } } : {});
  const ms = performance.now() - started;
  const best: Place | undefined = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
  const truth: LngLat = [record.lng, record.lat];
  const errorM = best ? distanceM(best.coordinate, truth) : NOT_FOUND;
  const streetOk = Boolean(best?.components.street && streetKey(best.components.street).key === streetKey(record.street).key);
  const hoodOk = record.hood && best?.components.neighbourhood ? nameKey(best.components.neighbourhood) === nameKey(record.hood) : record.hood ? false : null;
  const districtOk = Boolean(best?.components.district && nameKey(best.components.district) === nameKey(record.district));
  const unit = checkUnit(record);
  return { id: record.id, source: record.source, ops: record.ops, status: result.status, precision: best?.precision ?? null, errorM, streetOk, hoodOk, districtOk, ms, ...(unit ? { unit } : {}) };
}

export type G3Outcome = { plate: string; anchors: number; errorM: number; precision: string };

export async function evalSequence(plate: string, perStreet = 2, limit = 1500, version = DATA_VERSION): Promise<G3Outcome[]> {
  const store = await createNodePackStore(packsDir(version));
  const db = await store.open(plate);
  if (!db) return [];
  const region = await openRegion(db);
  const raw = await db.all<{ id: number; street_id: number; district_id: number; hood_id: number | null; num: number; parity: number; lon: number; lat: number; suffix: string }>(
    "SELECT id, street_id, district_id, hood_id, num, parity, lon, lat, suffix FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND parity IS NOT NULL ORDER BY id",
  );
  const groups = new Map<string, typeof raw>();
  for (const r of raw) {
    const key = `${r.street_id}:${r.district_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const rng = seeded(4242);
  const out: G3Outcome[] = [];
  const streets = [...groups.values()].filter((g) => g.filter((r) => r.suffix === '').length >= 4);
  for (const group of streets) {
    for (let t = 0; t < perStreet && out.length < limit * 4; t++) {
      const target = pick(rng, group.filter((r) => r.suffix === ''));
      const others = group.filter((o) => o.id !== target.id && o.num !== target.num && o.suffix === '');
      const street = { id: target.street_id, hoodId: target.hood_id, districtId: target.district_id };
      const number = { int: target.num, key: String(target.num), parity: target.parity as 0 | 1 };
      const parts = await region.partsOf(target.street_id);
      for (const keep of [0, 1, 2, others.length]) {
        if (keep > others.length || (keep === others.length && keep <= 2)) continue;
        const kept = new Set<number>();
        const pool = [...others];
        while (kept.size < keep && pool.length > 0) kept.add(pool.splice(Math.floor(rng() * pool.length), 1)[0]!.id);
        const exclude = new Set(group.filter((o) => !kept.has(o.id)).map((o) => o.id));
        const p = await predictNumber(region, street, number, { exclude, parts });
        const anchors = keep === others.length ? 99 : keep;
        if (p) out.push({ plate, anchors, errorM: distanceM(p.coordinate, [target.lon / 1e6, target.lat / 1e6]), precision: p.precision });
      }
    }
    if (out.length >= limit * 4) break;
  }
  return out;
}

const pct = (n: number): string => `%${n.toFixed(1)}`;
const row = (name: string, s: Stats): string => `| ${name} | ${s.count} | ${s.median} | ${s.p90} | ${pct(s.within15)} | ${pct(s.within30)} | ${pct(s.within50)} |`;
const HEAD = ['| Grup | Adet | Ortanca m | p90 m | ≤15 m | ≤30 m | ≤50 m |', '|---|---|---|---|---|---|---|'];

async function runText(set: string, wanted: string[], hint: boolean): Promise<string[]> {
  const search = await openSearch();
  const all: TextOutcome[] = [];
  const lines = [`## ${set.toUpperCase()}: metin → nokta (${hint ? 'il ipuçlu' : 'ipucusuz'})`, '', ...HEAD];
  for (const plate of wanted) {
    const records = readSet<TextRecord>(set, plate);
    if (records.length === 0) continue;
    const outcomes: TextOutcome[] = [];
    for (const r of records) outcomes.push(await evalText(search, r, hint));
    search.invalidate(plate);
    all.push(...outcomes);
    lines.push(row(plate, stats(outcomes.map((o) => o.errorM))));
  }
  lines.push(row('**toplam**', stats(all.map((o) => o.errorM))));
  const share = (f: (o: TextOutcome) => boolean): string => pct((100 * all.filter(f).length) / Math.max(1, all.length));
  lines.push('', '| Ölçü | Değer |', '|---|---|');
  lines.push(`| Sokak doğru | ${share((o) => o.streetOk)} |`, `| Mahalle doğru (mahallesi olanlarda) | ${pct((100 * all.filter((o) => o.hoodOk === true).length) / Math.max(1, all.filter((o) => o.hoodOk !== null).length))} |`);
  lines.push(`| Bulunamadı | ${share((o) => o.status === 'not_found')} |`, `| Belirsiz | ${share((o) => o.status === 'ambiguous')} |`);
  const precisions = new Map<string, number>();
  for (const o of all) precisions.set(o.precision ?? 'yok', (precisions.get(o.precision ?? 'yok') ?? 0) + 1);
  lines.push(`| Kesinlik dağılımı | ${[...precisions.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct((100 * v) / all.length)}`).join(', ')} |`);
  const speeds = stats(all.map((o) => o.ms));
  lines.push(`| Süre (Node) | ortanca ${speeds.median} ms, p90 ${speeds.p90} ms, p99 ${speeds.p99} ms |`);
  const unitShare = (key: keyof UnitCheck): string => {
    const checked = all.filter((o) => o.unit && o.unit[key] !== null);
    return `${pct((100 * checked.filter((o) => o.unit![key] === true).length) / Math.max(1, checked.length))} (${checked.length})`;
  };
  lines.push('', '### Bina içi ayrıştırma (birim ifadesi olan kayıtlar)', '', '| Alan | Doğru (adet) |', '|---|---|');
  lines.push(`| Kat | ${unitShare('floor')} |`, `| Daire | ${unitShare('door')} |`, `| Blok | ${unitShare('block')} |`);
  lines.push('', '### Kaynağa göre', '', ...HEAD);
  for (const source of ['osm', 'business']) lines.push(row(source === 'osm' ? 'OSM kapısı' : 'işletme kapısı (OSM\'de yok)', stats(all.filter((o) => o.source === source).map((o) => o.errorM))));
  lines.push('', '### Bozma işlecine göre (işleç varken)', '', ...HEAD);
  const ops = [...new Set(all.flatMap((o) => o.ops))].sort();
  for (const op of ops) lines.push(row(op, stats(all.filter((o) => o.ops.includes(op)).map((o) => o.errorM))));
  lines.push(row('işleçsiz', stats(all.filter((o) => o.ops.length === 0).map((o) => o.errorM))));
  mkdirSync(join(setsDir(), 'results'), { recursive: true });
  writeFileSync(join(setsDir(), 'results', `${set}${hint ? '-hint' : ''}.json`), JSON.stringify(all));
  return lines;
}

async function runPlaces(wanted: string[]): Promise<string[]> {
  const search = await openSearch();
  let total = 0;
  let first = 0;
  let top3 = 0;
  const ms: number[] = [];
  const lines = ['## G7: yer ve işletme adı araması', '', '| İl | Adet | İlk sırada | İlk 3te |', '|---|---|---|---|'];
  for (const plate of wanted) {
    const records = readSet<PlaceRecord>('g7', plate);
    let f = 0;
    let t = 0;
    for (const r of records) {
      const started = performance.now();
      const result = await search.resolve(r.text);
      ms.push(performance.now() - started);
      const candidates = result.status === 'region_missing' ? [] : result.candidates;
      const index = candidates.findIndex((c) => distanceM(c.coordinate, [r.lng, r.lat]) <= 30);
      if (index === 0) f++;
      if (index >= 0 && index < 3) t++;
    }
    search.invalidate(plate);
    total += records.length;
    first += f;
    top3 += t;
    if (records.length > 0) lines.push(`| ${plate} | ${records.length} | ${pct((100 * f) / records.length)} | ${pct((100 * t) / records.length)} |`);
  }
  lines.push(`| **toplam** | ${total} | ${pct((100 * first) / Math.max(1, total))} | ${pct((100 * top3) / Math.max(1, total))} |`);
  const speed = stats(ms);
  lines.push('', `Süre (Node): ortanca ${speed.median} ms, p90 ${speed.p90} ms.`);
  return lines;
}

async function runReverse(wanted: string[]): Promise<string[]> {
  const search = await openSearch(DATA_VERSION, false);
  let total = 0;
  let street = 0;
  let exact = 0;
  let near = 0;
  const errors: number[] = [];
  const lines = ['## G8: nokta → adres (OSM\'de olmayan işletme kapıları, rehber kapalı)', '', '| İl | Adet | Sokak doğru | Numara tam | Numara ±2 |', '|---|---|---|---|---|'];
  for (const plate of wanted) {
    const records = readSet<Door>('g8', plate);
    let s1 = 0;
    let e1 = 0;
    let n1 = 0;
    for (const r of records) {
      const place = await search.reverse([r.lng, r.lat]);
      if (!place) continue;
      errors.push(distanceM(place.coordinate, [r.lng, r.lat]));
      if (place.components.street && streetKey(place.components.street).key === streetKey(r.street).key) {
        s1++;
        const got = Number.parseInt(place.components.houseNumber ?? '', 10);
        if (place.components.houseNumber?.toLocaleLowerCase('tr-TR') === r.number.toLocaleLowerCase('tr-TR')) e1++;
        if (Number.isFinite(got) && got % 2 === r.num % 2 && Math.abs(got - r.num) <= 2) n1++;
      }
    }
    search.invalidate(plate);
    total += records.length;
    street += s1;
    exact += e1;
    near += n1;
    if (records.length > 0) lines.push(`| ${plate} | ${records.length} | ${pct((100 * s1) / records.length)} | ${pct((100 * e1) / records.length)} | ${pct((100 * n1) / records.length)} |`);
  }
  lines.push(`| **toplam** | ${total} | ${pct((100 * street) / Math.max(1, total))} | ${pct((100 * exact) / Math.max(1, total))} | ${pct((100 * near) / Math.max(1, total))} |`);
  return lines;
}

async function runSequence(wanted: string[]): Promise<string[]> {
  const all: G3Outcome[] = [];
  const lines = ['## G3: gizle-tahmin et (kapı motoru, yalnız SDK)', '', '| Çapa | Adet | Ortanca m | p90 m | ≤15 m | ≤30 m | ≤50 m |', '|---|---|---|---|---|---|---|'];
  for (const plate of wanted) all.push(...(await evalSequence(plate)));
  for (const k of [0, 1, 2, 99]) lines.push(row(k === 99 ? 'tümü (gizlenen hariç)' : `${k}`, stats(all.filter((o) => o.anchors === k).map((o) => o.errorM))));
  lines.push('', `İller: ${wanted.length}. Kesinlik (0 çapa): ${[...new Set(all.filter((o) => o.anchors === 0).map((o) => o.precision))].join(', ')}.`);
  mkdirSync(join(setsDir(), 'results'), { recursive: true });
  writeFileSync(join(setsDir(), 'results', 'g3.json'), JSON.stringify(all));
  return lines;
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const set = (arg('--set') ?? 'g2').toLowerCase();
  const wanted = arg('--plates')?.split(',') ?? plates();
  const started = Date.now();
  const hint = process.argv.includes('--hint');
  const lines = set === 'g3' ? await runSequence(wanted) : set === 'g7' ? await runPlaces(wanted) : set === 'g8' ? await runReverse(wanted) : await runText(set, wanted, hint);
  const date = new Date().toISOString().slice(0, 10);
  const text = [`# Adres ölçümü: ${set.toUpperCase()} (${date}, veri ${DATA_VERSION})`, '', ...lines, '', `Süre: ${Math.round((Date.now() - started) / 1000)} sn.`, ''].join('\n');
  if (process.argv.includes('--report')) {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-olcum');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${set}${hint ? '-ipuclu' : ''}-${date}.md`), text);
  }
  console.log(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
