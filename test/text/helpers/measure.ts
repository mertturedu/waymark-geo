import { parseAddress } from '../../../src/core/text/parse';
import type { ParsedAddress } from '../../../src/core/text/types';
import { evaluate } from './evaluate';
import { generateSentences } from './sentence-generator';
import { runGolden, type GoldenCase } from './golden';
import type { AddressRecord } from './types';

export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGES: [number, number][] = [
  [0x20, 0x7e], [0x00, 0x1f], [0x80, 0x24f], [0x300, 0x36f], [0x370, 0x3ff], [0x400, 0x4ff], [0x590, 0x5ff], [0x600, 0x6ff], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff], [0x3040, 0x30ff], [0x4e00, 0x4e80], [0x1f300, 0x1f64f], [0x1f900, 0x1f9ff], [0xd800, 0xdfff],
];

const VOCABULARY = [
  'no', 'numara', 'kapı', 'daire', 'd', 'k', 'kat', 'blok', 'mah', 'mahallesi', 'sk', 'sokak', 'cd', 'caddesi', 'bulvar', 'apt', 'site', 'sitesi', 'street', 'floor', 'apartment',
  'straße', 'улица', 'дом', 'οδός', 'αριθμός', 'شارع', 'رقم', 'istanbul', 'kadıköy', 'merkez', 'ankara', 'çankaya', 'moda', 'atatürk', '1', '12', '12/3', '12-14', '34710', '1707.', '3.', 'elli', 'beş', 'yüz',
];

const SEPARATORS = [' ', ' ', ' ', ', ', '; ', '\n', '.', ': ', '/', '-', '  ', '\t'];

function codePointString(next: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const [from, to] = RANGES[Math.floor(next() * RANGES.length)] as [number, number];
    const code = from + Math.floor(next() * (to - from + 1));
    out += code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code);
  }
  return out;
}

export function fuzzInput(next: () => number): string {
  const roll = next();
  if (roll < 0.01) return codePointString(next, 500 + Math.floor(next() * 4500));
  if (roll < 0.4) return codePointString(next, Math.floor(next() * 60));
  const parts: string[] = [];
  const count = 1 + Math.floor(next() * 25);
  for (let i = 0; i < count; i++) parts.push(VOCABULARY[Math.floor(next() * VOCABULARY.length)] as string, SEPARATORS[Math.floor(next() * SEPARATORS.length)] as string);
  const text = parts.join('');
  return roll < 0.45 ? text + codePointString(next, 5) : roll < 0.5 ? text.repeat(30) : text;
}

const STRING_OR_NULL = ['neighbourhood', 'houseNumber', 'building', 'block', 'floor', 'door', 'poiName', 'postcode'] as const;

export function shapeProblem(input: string, parsed: ParsedAddress): string | null {
  if (typeof parsed.input !== 'string' || parsed.input.length > 500) return 'input';
  if (input.length <= 500 && parsed.input !== input) return 'input changed';
  for (const key of STRING_OR_NULL) if (parsed[key] !== null && typeof parsed[key] !== 'string') return key;
  if (!Array.isArray(parsed.leftover) || parsed.leftover.some((word) => typeof word !== 'string')) return 'leftover';
  if (parsed.street !== null && (typeof parsed.street.key !== 'string' || typeof parsed.street.text !== 'string')) return 'street';
  if (parsed.province !== null && typeof parsed.province.id !== 'string') return 'province';
  if (parsed.district !== null && typeof parsed.district.id !== 'string') return 'district';
  return null;
}

export function measureFuzz(count: number, seed: number): { count: number; errors: { text: string; error: string }[]; badShape: { text: string; problem: string }[] } {
  const next = rng(seed);
  const errors: { text: string; error: string }[] = [];
  const badShape: { text: string; problem: string }[] = [];
  for (let i = 0; i < count; i++) {
    const text = fuzzInput(next);
    try {
      const problem = shapeProblem(text, parseAddress(text));
      if (problem) badShape.push({ text: text.slice(0, 80), problem });
    } catch (error) {
      errors.push({ text: text.slice(0, 80), error: String(error) });
    }
  }
  return { count, errors, badShape };
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function measureSpeed(texts: string[], calls: number): { calls: number; first: number; p50: number; p99: number; max: number } {
  const first = (() => {
    const start = now();
    parseAddress(texts[0] as string);
    return now() - start;
  })();
  for (let i = 0; i < Math.min(1000, calls); i++) parseAddress(texts[i % texts.length] as string);
  const samples: number[] = [];
  for (let i = 0; i < calls; i++) {
    const start = now();
    parseAddress(texts[i % texts.length] as string);
    samples.push(now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (p: number): number => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))] as number;
  return { calls, first, p50: at(0.5), p99: at(0.99), max: samples[samples.length - 1] as number };
}

export type K15 = { total: number; ok: number; rate: number; byLang: Record<string, { total: number; ok: number; rate: number }>; byProvince: Record<string, { total: number; ok: number; rate: number }>; wrongParts: Record<string, number>; failures: { text: string; wrong: string[] }[] };

export function measureK15(records: AddressRecord[], count: number, seed: number): K15 {
  const cases = generateSentences(records, count, seed);
  const byLang: K15['byLang'] = {};
  const byProvince: K15['byProvince'] = {};
  const wrongParts: Record<string, number> = {};
  const failures: K15['failures'] = [];
  let ok = 0;
  for (const c of cases) {
    const verdict = evaluate(parseAddress(c.text), c.expect, c.lang === 'ru' || c.lang === 'el' || c.lang === 'ar');
    for (const [bucket, key] of [[byLang, c.lang], [byProvince, c.province]] as const) {
      const row = (bucket[key] ??= { total: 0, ok: 0, rate: 0 });
      row.total++;
      if (verdict.ok) row.ok++;
    }
    if (verdict.ok) ok++;
    else {
      for (const part of verdict.wrong) wrongParts[part] = (wrongParts[part] ?? 0) + 1;
      if (failures.length < 50) failures.push({ text: c.text, wrong: verdict.wrong });
    }
  }
  for (const row of [...Object.values(byLang), ...Object.values(byProvince)]) row.rate = row.ok / row.total;
  return { total: cases.length, ok, rate: ok / cases.length, byLang, byProvince, wrongParts, failures };
}

export const goldenResult = (cases: GoldenCase[]) => runGolden(cases);
