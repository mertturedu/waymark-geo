import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { placeProps } from '../src/native/map/poi-glyphs';

const root = fileURLToPath(new URL('..', import.meta.url));

export type AuditRow = { name: string; cat: string; g: string | null; glyph: string; reason: string | null };

const NAME_RULES: { words: string[]; glyphs: string[] }[] = [
  { words: ['eczane', 'pharmacy'], glyphs: ['pharmacy'] },
  { words: ['cami', 'camii', 'mescit', 'mosque', 'kilise', 'church', 'sinagog', 'synagogue'], glyphs: ['mosque', 'church', 'synagogue', 'worship'] },
  { words: ['hastane', 'hastanesi', 'hospital'], glyphs: ['hospital', 'doctor', 'dentist', 'pharmacy'] },
  { words: ['okul', 'okulu', 'lise', 'lisesi', 'school', 'anaokulu', 'ilkokul', 'ortaokul'], glyphs: ['school', 'college', 'library', 'town-hall'] },
  { words: ['universite', 'üniversite', 'university', 'fakülte', 'fakulte'], glyphs: ['college', 'school', 'library'] },
  { words: ['banka', 'bank'], glyphs: ['bank', 'atm'] },
  { words: ['akaryakıt', 'akaryakit', 'petrol', 'benzin', 'shell', 'opet', 'bp'], glyphs: ['fuel', 'car-repair', 'car', 'parking'] },
  { words: ['otel', 'hotel', 'pansiyon', 'hostel'], glyphs: ['lodging'] },
  { words: ['kuaför', 'kuafor', 'berber', 'barber'], glyphs: ['hairdresser', 'beauty', 'spa', 'shop'] },
  { words: ['restoran', 'restaurant', 'lokanta', 'kebap', 'kebab'], glyphs: ['restaurant', 'fast-food', 'cafe', 'bar', 'bakery', 'none'] },
  { words: ['kafe', 'cafe', 'kahve', 'coffee'], glyphs: ['cafe', 'restaurant', 'fast-food', 'bar', 'bakery', 'none'] },
  { words: ['fırın', 'firin', 'bakery', 'pastane'], glyphs: ['bakery', 'cafe', 'restaurant', 'fast-food', 'shop', 'none'] },
  { words: ['karakol', 'polis'], glyphs: ['police'] },
  { words: ['itfaiye'], glyphs: ['fire-station'] },
  { words: ['postane', 'ptt'], glyphs: ['post'] },
  { words: ['müze', 'muze', 'museum'], glyphs: ['museum', 'monument', 'art-gallery'] },
];

const lower = (text: string): string => text.replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase();
const wordsOf = (text: string): string[] => lower(text).split(/[^a-z0-9çğıöşüâîû]+/).filter(Boolean);

export function suspect(name: string, glyph: string): string | null {
  const words = wordsOf(name);
  for (const rule of NAME_RULES) {
    const hit = rule.words.find((word) => words.some((w) => w === word || (word.length > 4 && w.startsWith(word))));
    if (hit && !rule.glyphs.includes(glyph)) return `"${hit}" geçiyor ama glif "${glyph}"`;
  }
  return null;
}

export function sampleOf<T>(items: T[], count: number, seed: number): T[] {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, count);
}

export function auditRows(rows: { name: string; cat: string; g?: string | null }[]): AuditRow[] {
  return rows.map((row) => {
    const glyph = placeProps(row.cat, row.g ?? null, row.name).k;
    return { name: row.name, cat: row.cat, g: row.g ?? null, glyph, reason: suspect(row.name, glyph) };
  });
}

export function renderTable(region: string, rows: AuditRow[]): string {
  const bad = rows.filter((row) => row.reason);
  const cell = (text: string): string => text.replace(/\|/g, '\\|');
  const line = (row: AuditRow): string => `| ${cell(row.name)} | ${cell(row.cat)} | ${row.glyph} | ${row.reason ? cell(row.reason) : ''} |`;
  return [`# Simge denetimi: il ${region}`, '', `${rows.length} örnek, ${bad.length} şüpheli (${rows.length === 0 ? 0 : Math.round((bad.length / rows.length) * 1000) / 10}%)`, '', '## Şüpheliler', '', '| Ad | Kategori | Glif | Neden |', '|---|---|---|---|', ...bad.map(line), '', '## Tüm örnekler', '', '| Ad | Kategori | Glif | Neden |', '|---|---|---|---|', ...rows.map(line), ''].join('\n');
}

function latestOverture(): string | null {
  const work = join(root, 'dist', 'work');
  if (!existsSync(work)) return null;
  const days = readdirSync(work).sort().reverse();
  return days.map((day) => join(work, day, 'overture')).find((dir) => existsSync(dir)) ?? null;
}

export function readRows(dir: string, region: string): { name: string; cat: string; g: string | null }[] {
  const file = join(dir, `${region}.rows.jsonl`);
  if (!existsSync(file)) throw new Error(`${file} yok`);
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as { name: string; cat: string; g: string | null }).filter((row) => row.name && row.cat);
}

function main(): number {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const regions = (value('--region') ?? '34').split(',');
  const sample = Number(value('--sample') ?? 500);
  const dir = value('--work') ?? latestOverture();
  if (!dir) {
    console.error('Overture çıktı klasörü bulunamadı (--work)');
    return 2;
  }
  const out = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'simge-denetimi');
  mkdirSync(out, { recursive: true });
  for (const region of regions) {
    const rows = auditRows(sampleOf(readRows(dir, region), sample, Number(region) + 1));
    writeFileSync(join(out, `${region}.md`), renderTable(region, rows));
    console.log(`il ${region}: ${rows.length} örnek, ${rows.filter((row) => row.reason).length} şüpheli`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
