import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { categoryOf, checkParts, cleanQuery, errorOf } from '../../scripts/addr-compare';
import type { TextRecord } from '../../scripts/addr-sets';
import { cached } from '../../tools/compare/cache';
import { libpostal } from '../../tools/compare/engines/libpostal';
import type { EngineResult } from '../../tools/compare/types';

const record = (over: Partial<TextRecord> = {}): TextRecord => ({
  id: '16:a:1', plate: '16', source: 'osm', lng: 28.95, lat: 40.22, province: 'Bursa', district: 'Nilüfer', hood: 'Fethiye', street: 'Gül Sokak', kind: 'sokak', number: '12', num: 12, text: 'Fethiye Mah. Gül Sk. 12', ops: [], ...over,
});

const result = (over: Partial<EngineResult> = {}): EngineResult => ({ found: true, point: [28.95, 40.22], level: 'building', parts: {}, ms: 1, ...over });

describe('errorOf', () => {
  it('measures metres to the truth and uses a large value when nothing was found', () => {
    expect(errorOf(result(), record())).toBeLessThan(0.01);
    expect(errorOf(result({ point: [28.951, 40.22] }), record())).toBeGreaterThan(80);
    expect(errorOf(result({ found: false, point: null }), record())).toBe(100_000);
  });
});

describe('checkParts', () => {
  it('compares every component after normalising names', () => {
    const parts = { province: 'bursa', district: 'NİLÜFER', hood: 'Fethiye Mahallesi', street: 'Gül Sk.', number: 'No: 12' };
    expect(checkParts(parts, record())).toEqual({ province: true, district: true, hood: true, street: true, number: true });
  });

  it('marks missing and wrong components and skips what the truth lacks', () => {
    const checked = checkParts({ province: 'Bursa', street: 'Lale Sokak' }, record({ hood: null }));
    expect(checked).toMatchObject({ province: true, district: false, hood: null, street: false, number: false });
  });
});

describe('categoryOf', () => {
  const verdict = (parts: EngineResult['parts'], found = true) => ({ engine: 'sdk', result: result({ found, parts }), errorM: 500 });

  it('names the first component that went wrong', () => {
    const good = { province: 'Bursa', district: 'Nilüfer', hood: 'Fethiye', street: 'Gül Sokak', number: '12' };
    expect(categoryOf(verdict({}, false), record())).toBe('ayrıştırma');
    expect(categoryOf(verdict({ ...good, street: 'Lale Sokak' }), record())).toBe('sokak');
    expect(categoryOf(verdict({ ...good, hood: 'Odunluk' }), record())).toBe('mahalle');
    expect(categoryOf(verdict(good), record())).toBe('kapı');
  });
});

describe('cleanQuery', () => {
  it('builds the plain street number district province form', () => {
    expect(cleanQuery(record())).toBe('Gül Sokak 12, Nilüfer, Bursa');
  });
});

describe('cache', () => {
  beforeAll(() => {
    process.env.YUKSI_GEO_KIYAS = mkdtempSync(join(tmpdir(), 'kiyas-'));
  });


  it('asks the engine once per key', async () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    let calls = 0;
    const run = async (): Promise<EngineResult> => {
      calls++;
      return result();
    };
    await cached('test-engine', key, run);
    await cached('test-engine', key, run);
    expect(calls).toBe(1);
  });
});

describe('libpostal engine', () => {
  it('maps parser roles to components', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify([['fethiye mah. gül sk.', 'road'], ['no 12', 'house_number'], ['nilüfer', 'city_district'], ['i̇stanbul', 'city'], ['kat 3', 'level']]))) as typeof fetch;
    try {
      const out = await libpostal('http://stub').query(`stub-${Math.random()}`);
      expect(out.parts).toEqual({ street: 'fethiye mah. gül sk.', number: '12', district: 'nilüfer', province: 'istanbul', floor: 'kat 3' });
    } finally {
      globalThis.fetch = original;
    }
  });
});
