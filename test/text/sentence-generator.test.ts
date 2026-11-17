import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressRecord } from '../../scripts/build-address-records';
import { evaluate } from './helpers/evaluate';
import { generateSentences, renderParts, type Parts } from './helpers/sentence-generator';
import { nameKey } from '../../src/core/text/fold';
import { parseAddress } from '../../src/core/text/parse';

const squash = (text: string): string => nameKey(text).split(' ').join('');

const { records } = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/address-records.json'), 'utf8')) as { records: AddressRecord[] };

describe('generateSentences', () => {
  const cases = generateSentences(records, 1000, 5);

  it('is deterministic and changes with the seed', () => {
    expect(generateSentences(records, 50, 5)).toEqual(cases.slice(0, 50));
    expect(generateSentences(records, 50, 6)).not.toEqual(cases.slice(0, 50));
  });

  it('uses all six languages, mostly Turkish', () => {
    const counts = new Map<string, number>();
    for (const c of cases) counts.set(c.lang, (counts.get(c.lang) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(['ar', 'de', 'el', 'en', 'ru', 'tr']);
    expect(counts.get('tr')).toBeGreaterThan(450);
    for (const lang of ['ar', 'de', 'el', 'en', 'ru']) expect(counts.get(lang)).toBeGreaterThan(80);
  });

  it('draws from every priority province', () => {
    expect(new Set(cases.map((c) => c.province)).size).toBe(12);
  });

  it('writes the house number into every sentence', () => {
    for (const c of cases) expect(squash(c.text)).toContain(squash(c.expect.houseNumber.split('/')[0]?.split('-')[0] as string));
  });

  it('only expects parts that the sentence carries', () => {
    const without = cases.filter((c) => c.expect.district === undefined).length;
    expect(without).toBeGreaterThan(30);
    expect(without).toBeLessThan(200);
    expect(cases.some((c) => c.expect.door !== undefined)).toBe(true);
    expect(cases.some((c) => c.expect.neighbourhood === undefined)).toBe(true);
  });

  it('writes Cyrillic and Greek for the ru and el sentences', () => {
    expect(cases.filter((c) => c.lang === 'ru').every((c) => /[а-яё]/i.test(c.text))).toBe(true);
    expect(cases.filter((c) => c.lang === 'el').every((c) => /[α-ως]/i.test(c.text))).toBe(true);
    expect(cases.filter((c) => c.lang === 'ar').every((c) => /[؀-ۿ]/.test(c.text))).toBe(true);
  });

  it('writes Latin sentences without a stray non-ASCII mix', () => {
    for (const c of cases.filter((x) => x.lang === 'en' || x.lang === 'de')) expect(c.text).not.toMatch(/[а-яёα-ως؀-ۿ]/i);
  });
});

describe('renderParts', () => {
  const parts: Parts = { lang: 'tr', province: 'İstanbul', district: 'Kadıköy', hood: 'Moda', street: 'Bahariye Caddesi', number: '14', door: '3', floor: null, block: null };
  const flat = () => 0;

  it('puts every part into the text', () => {
    const text = renderParts(parts, flat, { hoodMarker: true });
    for (const piece of ['İstanbul', 'Kadıköy', 'Moda', 'Bahariye', '14', '3']) expect(text).toContain(piece);
  });

  it('leaves out the neighbourhood word when asked', () => {
    expect(renderParts(parts, flat, { hoodMarker: false })).not.toMatch(/Mah/);
  });

  it('is read back correctly by the parser for a plain Turkish case', () => {
    const text = renderParts(parts, flat, { hoodMarker: true });
    const verdict = evaluate(parseAddress(text), { province: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '14', door: '3' }, false);
    expect(verdict).toEqual({ ok: true, wrong: [] });
  });
});

describe('evaluate', () => {
  const parsed = parseAddress('Bahariye Cd. no 14 Kadıköy');

  it('says ok when everything expected is there, ignoring spacing and case', () => {
    expect(evaluate(parsed, { district: 'Kadıköy', street: 'Bahariye Caddesi', houseNumber: '14' }, false).ok).toBe(true);
  });

  it('names every wrong part', () => {
    const verdict = evaluate(parsed, { province: '06', district: 'Çankaya', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '15', door: '2', floor: '1', block: 'A' }, false);
    expect(verdict.wrong).toEqual(['province', 'district', 'neighbourhood', 'street', 'houseNumber', 'door', 'floor', 'block']);
  });

  it('accepts doubled letters in loose mode only', () => {
    const greek = parseAddress('Οδός Παμούκαλε 5');
    expect(evaluate(greek, { street: 'Pamukkale Sokak', houseNumber: '5' }, true).ok).toBe(true);
    expect(evaluate(greek, { street: 'Pamukkale Sokak', houseNumber: '5' }, false).wrong).toContain('street');
  });
});
