import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { nameKey } from '../src/core/text';
import { streetKey } from '../src/core/text/street';
import { libpostal } from '../tools/compare/engines/libpostal';
import { llm } from '../tools/compare/engines/llm';
import { nominatim } from '../tools/compare/engines/nominatim';
import { recordMeasure } from '../tools/compare/measures';
import { photon } from '../tools/compare/engines/photon';
import { sdk } from '../tools/compare/engines/sdk';
import type { Engine, EngineResult, Parts } from '../tools/compare/types';
import { openSearch, stats, type Stats } from './addr-eval';
import { plates, readSet, type TextRecord } from './addr-sets';

const NOT_FOUND = 100_000;
const NEAR_M = 30;
const QUEUE_SAMPLES = 50;
const CATEGORIES = ['ayrıştırma', 'mahalle', 'sokak', 'kapı', 'yer'] as const;

type Category = (typeof CATEGORIES)[number];
type Verdict = { engine: string; result: EngineResult; errorM: number };
type Row = { record: TextRecord; verdicts: Map<string, Verdict> };

const pct = (value: number): string => `%${value.toFixed(1)}`;
const share = (count: number, total: number): number => (total === 0 ? 0 : (100 * count) / total);

export const errorOf = (result: EngineResult, record: { lng: number; lat: number }): number => (result.point ? distanceM(result.point, [record.lng, record.lat]) : NOT_FOUND);

const flat = (value: string | undefined): string => (value ?? '').toLocaleLowerCase('tr-TR').replace(/[^0-9a-zçğıöşü]/g, '');
const numberKey = (value: string): string => flat(value).replace(/^(numara|no|n)(?=\d)/, '');
const hoodKey = (value: string): string => nameKey(value.toLocaleLowerCase('tr-TR').replace(/\s+(mahallesi|mahalle|mah\.?|mh\.?)$/, ''));

export type PartsCheck = { province: boolean | null; district: boolean | null; hood: boolean | null; street: boolean | null; number: boolean | null };

export function checkParts(parts: Parts, record: TextRecord): PartsCheck {
  const same = (got: string | undefined, want: string | null, key: (v: string) => string): boolean | null => (want ? got !== undefined && key(got) === key(want) : null);
  const written = (op: string, want: string | null): string | null => (record.ops.includes(op) ? null : want);
  return {
    province: same(parts.province, written('province_drop', record.province), nameKey),
    district: same(parts.district, written('district_drop', record.district), nameKey),
    hood: same(parts.hood, written('hood_drop', record.hood), hoodKey),
    street: same(parts.street, record.street, (v) => streetKey(v).key),
    number: same(parts.number, record.number, numberKey),
  };
}

export function categoryOf(sdkVerdict: Verdict, record: TextRecord): Category {
  const parts = checkParts(sdkVerdict.result.parts, record);
  if (!sdkVerdict.result.found) return 'ayrıştırma';
  if (parts.street === false) return 'sokak';
  if (parts.hood === false) return 'mahalle';
  if (record.unit && parts.number === false) return 'ayrıştırma';
  return 'kapı';
}

type Slot = Engine & { input?: (record: TextRecord) => string };

export const cleanQuery = (r: TextRecord): string => `${r.street} ${r.number}, ${r.district}, ${r.province}`;

const withClean = (engine: Engine): Slot => ({ name: `${engine.name}-temiz`, query: engine.query, input: cleanQuery });

async function runAll(rows: TextRecord[], engines: Slot[], workers: number): Promise<Row[]> {
  const out: Row[] = rows.map((record) => ({ record, verdicts: new Map() }));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < out.length; i = next++) {
      const row = out[i]!;
      for (const engine of engines) {
        const result = await engine.query(engine.input ? engine.input(row.record) : row.record.text);
        row.verdicts.set(engine.name, { engine: engine.name, result, errorM: errorOf(result, row.record) });
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

const HEAD = ['| Motor | Adet | Buldu | ≤30 m | Ortanca m | p90 m | Süre ortanca ms |', '|---|---|---|---|---|---|---|'];

function coordinateLine(name: string, rows: Row[]): string {
  const verdicts = rows.map((r) => r.verdicts.get(name)).filter((v): v is Verdict => v !== undefined);
  const s: Stats = stats(verdicts.map((v) => v.errorM));
  const found = verdicts.filter((v) => v.result.point).length;
  const ms = stats(verdicts.map((v) => v.result.ms));
  return `| ${name} | ${verdicts.length} | ${pct(share(found, verdicts.length))} | ${pct(s.within30)} | ${s.median} | ${s.p90} | ${ms.median} |`;
}

function agreement(rows: Row[], rival: string): string {
  let both = 0;
  let onlySdk = 0;
  let onlyRival = 0;
  let neither = 0;
  for (const r of rows) {
    const a = r.verdicts.get('sdk');
    const b = r.verdicts.get(rival);
    if (!a || !b) continue;
    const okA = a.errorM <= NEAR_M;
    const okB = b.errorM <= NEAR_M;
    if (okA && okB) both++;
    else if (okA) onlySdk++;
    else if (okB) onlyRival++;
    else neither++;
  }
  const total = both + onlySdk + onlyRival + neither;
  return `| ${rival} | ${pct(share(both, total))} | ${pct(share(onlySdk, total))} | ${pct(share(onlyRival, total))} | ${pct(share(neither, total))} |`;
}

function parseTable(rows: Row[], names: string[]): string[] {
  const keys: (keyof PartsCheck)[] = ['province', 'district', 'hood', 'street', 'number'];
  const lines = ['| Motor | İl | İlçe | Mahalle | Sokak | Numara |', '|---|---|---|---|---|---|'];
  for (const name of names) {
    const cells = keys.map((key) => {
      const checked = rows.map((r) => ({ r, v: r.verdicts.get(name) })).filter((x) => x.v && checkParts(x.v.result.parts, x.r.record)[key] !== null);
      const good = checked.filter((x) => checkParts(x.v!.result.parts, x.r.record)[key] === true).length;
      return checked.length === 0 ? '-' : `${pct(share(good, checked.length))} (${checked.length})`;
    });
    lines.push(`| ${name} | ${cells.join(' | ')} |`);
  }
  return lines;
}

type QueueItem = { id: string; text: string; truth: { street: string; hood: string | null; district: string; number: string }; sdk: { street?: string; hood?: string; number?: string; errorM: number }; rival: string; rivalErrorM: number; closed: boolean };

function writeQueue(rows: Row[], rivals: string[], outDir: string): string[] {
  const groups = new Map<Category, QueueItem[]>();
  for (const row of rows) {
    const mine = row.verdicts.get('sdk');
    if (!mine || mine.errorM <= NEAR_M) continue;
    const winner = rivals.map((name) => row.verdicts.get(name)).find((v) => v && v.errorM <= NEAR_M);
    if (!winner) continue;
    const category = categoryOf(mine, row.record);
    const list = groups.get(category) ?? [];
    list.push({
      id: row.record.id,
      text: row.record.text,
      truth: { street: row.record.street, hood: row.record.hood, district: row.record.district, number: row.record.number },
      sdk: { street: mine.result.parts.street, hood: mine.result.parts.hood, number: mine.result.parts.number, errorM: Math.round(mine.errorM) },
      rival: winner.engine,
      rivalErrorM: Math.round(winner.errorM),
      closed: false,
    });
    groups.set(category, list);
  }
  mkdirSync(outDir, { recursive: true });
  const lines: string[] = [];
  for (const category of CATEGORIES) {
    const list = groups.get(category) ?? [];
    lines.push(`| ${category} | ${list.length} | ${Math.min(list.length, QUEUE_SAMPLES)} |`);
    writeFileSync(join(outDir, `${category}.json`), JSON.stringify({ category, total: list.length, items: list.slice(0, QUEUE_SAMPLES) }, null, 1));
  }
  return lines;
}

export type CompareOptions = { set: string; plates: string[]; limit: number; engines: string[]; llmModels: string[]; llmLimit: number; workers: number };

export async function compare(options: CompareOptions): Promise<string> {
  const records: TextRecord[] = [];
  for (const plate of options.plates) {
    const list = readSet<TextRecord>(options.set, plate);
    const step = Math.max(1, Math.floor(list.length / options.limit));
    records.push(...list.filter((_, i) => i % step === 0).slice(0, options.limit));
  }
  const search = await openSearch();
  const fast: Slot[] = [sdk(search)];
  for (const [name, make] of [['nominatim', nominatim], ['photon', photon]] as const) {
    if (!options.engines.includes(name)) continue;
    const engine = make();
    fast.push(engine, withClean(engine));
  }
  const parsers: Slot[] = options.engines.includes('libpostal') ? [libpostal()] : [];
  const rows = await runAll(records, [...fast, ...parsers], options.workers);

  const sample = rows.slice(0, options.llmLimit);
  const slow = options.llmModels.map((m) => llm(m));
  for (const engine of slow) {
    const done = await runAll(sample.map((r) => r.record), [engine], 1);
    done.forEach((d, i) => d.verdicts.forEach((v, k) => sample[i]!.verdicts.set(k, v)));
  }

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-kiyas', date);
  const rivals = fast.slice(1).map((e) => e.name);
  const queueRivals = rivals;
  const lines = [`# Adres kıyası: ${options.set.toUpperCase()}, ${options.plates.join(', ')} (${rows.length} kayıt)`, ''];
  for (const [title, subset] of [
    ['Tüm kayıtlar', rows],
    ['İşletme kapıları (OSM\'de yok, rakipler bilmiyor: adil kıyas)', rows.filter((r) => r.record.source === 'business')],
    ['OSM kapıları (rakipler bu kapıları zaten biliyor)', rows.filter((r) => r.record.source === 'osm')],
  ] as [string, Row[]][]) {
    lines.push(`## ${title}`, '', ...HEAD, ...fast.map((e) => coordinateLine(e.name, subset)), '');
    if (rivals.length > 0) lines.push('| Rakip | İkisi de ≤30 m | Yalnız SDK | Yalnız rakip | İkisi de değil |', '|---|---|---|---|---|', ...rivals.map((r) => agreement(subset, r)), '');
  }
  lines.push('## Ayrıştırma doğruluğu', '', ...parseTable(rows, ['sdk', ...rivals.filter((name) => !name.endsWith('-temiz')), ...parsers.map((e) => e.name)]), '');
  if (slow.length > 0) lines.push(`### Dil modelleri (ilk ${sample.length} kayıt)`, '', ...parseTable(sample, ['sdk', ...slow.map((e) => e.name)]), '');
  if (rivals.length > 0) {
    const queue = writeQueue(rows, queueRivals, join(outDir, options.set));
    lines.push('## Farklılık kuyruğu (rakip buldu, SDK bulamadı)', '', '| Tür | Toplam | Kuyruğa yazılan |', '|---|---|---|', ...queue, '', `Dosyalar: ${join(outDir, options.set)}`, '');
  }
  const text = lines.join('\n');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `kiyas-${options.set}-${options.plates.join('_')}.md`), text);
  return text;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
  };
  const wanted = arg('plates', '34').split(',');
  const started = Date.now();
  const text = await compare({
    set: arg('set', 'g2'),
    plates: wanted[0] === 'all' ? plates() : wanted,
    limit: Number(arg('limit', '1000')),
    engines: arg('engines', 'nominatim,photon').split(','),
    llmModels: arg('llm', '').split(',').filter(Boolean),
    llmLimit: Number(arg('llm-limit', '200')),
    workers: Number(arg('workers', '6')),
  });
  console.log(text);
  if (args.includes('--bench')) {
    const records = Number(text.match(/\((\d+) kayıt\)/)?.[1] ?? 0);
    recordMeasure('a1_1', { records, seconds: Math.round((Date.now() - started) / 1000), engines: arg('engines', 'nominatim,photon') });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
