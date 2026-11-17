import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameKey, parseAddress } from '../src/core/text';
import type { ParsedAddress } from '../src/core/text';
import { floorNumber } from '../src/core/address/unit';
import { streetKey } from '../src/core/text/street';
import { libpostal } from '../tools/compare/engines/libpostal';
import { recordMeasure } from '../tools/compare/measures';
import type { Parts } from '../tools/compare/types';
import { readSet, type TextRecord } from './addr-sets';

export const COMPONENTS = ['province', 'district', 'hood', 'street', 'number', 'floor', 'door', 'block'] as const;
export type Component = (typeof COMPONENTS)[number];

const flat = (value: string | null | undefined): string => (value ?? '').toLocaleLowerCase('tr-TR').replace(/[^0-9a-zçğıöşü]/g, '');
const nameFlat = (value: string): string => flat(nameKey(value));
const sameDistrict = (got: string, want: string): boolean => {
  const a = nameFlat(got);
  const b = nameFlat(want);
  return a === b || b.endsWith(a) || a.endsWith(b);
};
const hoodKey = (value: string): string => nameKey(value.toLocaleLowerCase('tr-TR').replace(/\s+(mahallesi|mahalle|mah\.?|mh\.?)$/, ''));

export type Flags = Partial<Record<Component, boolean>>;

export function writtenOf(record: TextRecord): Flags {
  const has = (op: string): boolean => record.ops.includes(op);
  return {
    province: !has('province_drop'),
    district: !has('district_drop') && !has('district_wrong'),
    hood: record.hood !== null && !has('hood_drop') && !has('hood_typo'),
    street: !has('street_typo'),
    number: true,
    floor: record.unit?.floor !== undefined,
    door: record.unit?.door !== undefined,
    block: record.unit?.block !== undefined,
  };
}

export const excludedOf = (record: TextRecord): Flags => ({
  district: record.ops.includes('district_wrong'),
  hood: record.ops.includes('hood_typo'),
  street: record.ops.includes('street_typo'),
});

export const predictedOf = (p: ParsedAddress): Flags => ({
  province: p.province !== null,
  district: p.district !== null,
  hood: p.neighbourhood !== null,
  street: p.street !== null,
  number: p.houseNumber !== null,
  floor: p.floor !== null,
  door: p.door !== null,
  block: p.block !== null,
});

export function correctOf(parsed: ParsedAddress, record: TextRecord): Flags {
  const written = writtenOf(record);
  const out: Flags = {};
  if (written.province) out.province = parsed.province !== null && nameKey(parsed.province.name) === nameKey(record.province);
  if (written.district) out.district = parsed.district !== null && sameDistrict(parsed.district.name, record.district);
  if (written.hood && record.hood) out.hood = parsed.neighbourhood !== null && hoodKey(parsed.neighbourhood) === hoodKey(record.hood);
  if (written.street) out.street = parsed.street !== null && parsed.street.key === streetKey(record.street).key;
  const gotNumber = flat(parsed.houseNumber).replace(/^(numara|no|n)(?=\d)/, '');
  const wantNumber = flat(record.number);
  const wantDoor = flat(record.unit?.door);
  out.number = gotNumber === wantNumber || (wantDoor !== '' && gotNumber === `${wantNumber}${wantDoor}` && flat(parsed.door) === '');
  if (written.floor) out.floor = flat(parsed.floor) === flat(record.unit?.floor) || (parsed.floor !== null && floorNumber(parsed.floor) !== null && floorNumber(parsed.floor) === floorNumber(record.unit?.floor ?? null));
  if (written.door) out.door = flat(parsed.door) === flat(record.unit?.door);
  if (written.block) out.block = flat(parsed.block) === flat(record.unit?.block);
  return out;
}

function inferredRight(parsed: ParsedAddress, record: TextRecord, component: Component): boolean {
  if (component === 'province') return parsed.province !== null && nameKey(parsed.province.name) === nameKey(record.province);
  if (component === 'district') return parsed.district !== null && sameDistrict(parsed.district.name, record.district);
  if (component === 'hood') return parsed.neighbourhood !== null && record.hood !== null && hoodKey(parsed.neighbourhood) === hoodKey(record.hood);
  return false;
}

const wrongCount = (flags: Flags): number => Object.values(flags).filter((v) => v === false).length;

export function bestVariant(parsed: ParsedAddress, record: TextRecord): { variant: ParsedAddress; correct: Flags } {
  let best = { variant: parsed, correct: correctOf(parsed, record) };
  for (const alt of parsed.alternatives) {
    const correct = correctOf(alt, record);
    if (wrongCount(correct) < wrongCount(best.correct)) best = { variant: alt, correct };
  }
  return best;
}

export type Evaluated = { record: TextRecord; parsed: ParsedAddress; primary: Flags; best: Flags; bestVariant: ParsedAddress; ms: number };

export function evaluate(records: TextRecord[], parse: (text: string) => ParsedAddress = parseAddress): Evaluated[] {
  return records.map((record) => {
    const started = performance.now();
    const parsed = parse(record.text);
    const ms = performance.now() - started;
    const best = bestVariant(parsed, record);
    return { record, parsed, primary: correctOf(parsed, record), best: best.correct, bestVariant: best.variant, ms };
  });
}

export type Prf = { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };

export function prf(rows: Evaluated[], component: Component, mode: 'primary' | 'best'): Prf {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    if (excludedOf(row.record)[component]) continue;
    const wanted = writtenOf(row.record)[component] === true;
    const variant = mode === 'best' ? row.bestVariant : row.parsed;
    const given = predictedOf(variant)[component] === true;
    const right = (mode === 'best' ? row.best : row.primary)[component] === true;
    if (wanted && right) tp++;
    else if (!wanted && given && inferredRight(variant, row.record, component)) continue;
    else {
      if (given) fp++;
      if (wanted) fn++;
    }
  }
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return { tp, fp, fn, precision, recall, f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall) };
}

export const wrongShare = (rows: Evaluated[], mode: 'primary' | 'best' = 'best'): number => (rows.length === 0 ? 0 : (100 * rows.filter((r) => wrongCount(mode === 'best' ? r.best : r.primary) > 0).length) / rows.length);

export function fromParts(parts: Parts): ParsedAddress {
  const name = (value: string | undefined) => (value === undefined ? null : { id: '', name: value, ambiguous: false });
  const street = parts.street === undefined ? null : { text: parts.street, key: streetKey(parts.street).key, compact: '', kind: null, number: null };
  return {
    input: '', language: null, province: name(parts.province), district: name(parts.district), neighbourhood: parts.hood ?? null, street, secondStreet: null,
    houseNumber: parts.number ?? null, building: null, block: parts.block ?? null, entrance: null, floor: parts.floor ?? null, door: parts.door ?? null, poiName: parts.place ?? null,
    postcode: null, leftover: [], dropped: [], alternatives: [],
  };
}

const pct = (value: number): string => `%${(100 * value).toFixed(1)}`;

function table(title: string, rows: Evaluated[], mode: 'primary' | 'best'): string[] {
  const lines = [`### ${title}`, '', '| Bileşen | Kesinlik | Duyarlılık | F1 | Beklenen |', '|---|---|---|---|---|'];
  for (const c of COMPONENTS) {
    const s = prf(rows, c, mode);
    lines.push(`| ${c} | ${pct(s.precision)} | ${pct(s.recall)} | ${pct(s.f1)} | ${s.tp + s.fn} |`);
  }
  return lines;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
  };
  const set = arg('set', 'g2');
  const plates = arg('plates', '06,10,16,20,34,35,38,41,42,45,58,59').split(',');
  const limit = Number(arg('limit', '500'));
  const offset = Number(arg('offset', '0'));
  const records: TextRecord[] = [];
  for (const plate of plates) records.push(...readSet<TextRecord>(set, plate).slice(offset, offset + limit));
  const rows = evaluate(records);
  console.log(`${set}: ${rows.length} kayıt, ${plates.length} il, başlangıç ${offset}`);
  console.log(table('İlk ayrıştırma', rows, 'primary').join('\n'));
  console.log(table('N-en-iyi (ilk ayrıştırma + alternatifler, en iyi aday)', rows, 'best').join('\n'));
  console.log(`\nHerhangi bir bileşeni yanlış: ilk %${wrongShare(rows, 'primary').toFixed(1)}, N-en-iyi %${wrongShare(rows).toFixed(1)}`);
  const ops = [...new Set(rows.flatMap((r) => r.record.ops))].sort();
  console.log('\n| İşleç | Adet | Yanlış % (N-en-iyi) |\n|---|---|---|');
  for (const op of ops) {
    const subset = rows.filter((r) => r.record.ops.includes(op));
    console.log(`| ${op} | ${subset.length} | ${wrongShare(subset).toFixed(1)} |`);
  }
  const speeds = rows.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\nSüre: ortanca ${speeds[Math.floor(speeds.length / 2)]?.toFixed(3)} ms, p95 ${speeds[Math.floor(speeds.length * 0.95)]?.toFixed(3)} ms`);

  const unwanted = rows.filter((r) => {
    if (r.parsed.dropped.length === 0) return false;
    if (!r.record.ops.includes('phone') && !r.record.ops.includes('note')) return true;
    const own = new Set([r.record.street, r.record.hood ?? '', r.record.district, r.record.province].flatMap((name) => nameKey(name).split(' ')).filter((w) => /^[a-z]{3,}$/.test(w)));
    return r.parsed.dropped.some((text) => text.split(' ').some((w) => own.has(w)));
  });
  console.log(`Yanlış silme (telefon ve not dışı ya da adres sözcüğü silinen kayıt): ${unwanted.length}`);

  const f1Of = (list: Evaluated[], mode: 'primary' | 'best') => Object.fromEntries(COMPONENTS.map((c) => [c, Number((100 * prf(list, c, mode).f1).toFixed(1))]));
  const measure: Record<string, unknown> = {
    set, plates, count: rows.length, offset,
    f1: f1Of(rows, 'best'),
    f1Primary: f1Of(rows, 'primary'),
    wrongBest: Number(wrongShare(rows).toFixed(1)),
    falseDrops: unwanted.length,
    p95ms: Number((speeds[Math.floor(speeds.length * 0.95)] ?? 0).toFixed(3)),
  };

  if (args.includes('--libpostal')) {
    const engine = libpostal();
    const peers = evaluate(records, () => fromParts({}));
    for (let i = 0; i < records.length; i++) {
      const record = records[i] as TextRecord;
      const variant = fromParts((await engine.query(record.text)).parts);
      const peer = peers[i] as Evaluated;
      peer.parsed = variant;
      peer.bestVariant = variant;
      peer.primary = correctOf(variant, record);
      peer.best = peer.primary;
    }
    console.log('\n' + table('libpostal', peers, 'primary').join('\n'));
    measure.libpostal = f1Of(peers, 'primary');
  }

  const dir = join(homedir(), '.yuksi-geo', 'kiyas', 'ayristirma');
  mkdirSync(dir, { recursive: true });
  for (const c of COMPONENTS) {
    const bad = rows.filter((r) => r.best[c] === false);
    writeFileSync(join(dir, `${set}-${c}.json`), JSON.stringify(bad.slice(0, 400).map((r) => ({ text: r.record.text, ops: r.record.ops, truth: { street: r.record.street, number: r.record.number, hood: r.record.hood, district: r.record.district, unit: r.record.unit }, parsed: { street: r.parsed.street?.text, number: r.parsed.houseNumber, hood: r.parsed.neighbourhood, district: r.parsed.district?.name, floor: r.parsed.floor, door: r.parsed.door, block: r.parsed.block, leftover: r.parsed.leftover } })), null, 1));
  }
  if (args.includes('--record')) recordMeasure(arg('key', 'a2_parse'), measure);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
