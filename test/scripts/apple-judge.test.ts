import type { LngLat } from '../../src/core/geo/cells';
import type { Polygon } from '../../src/core/region/geom';
import { expandShort, insideBuffered, judgeOne, nameOverlap, numbersMatch, sameStreet, type Context, type Raw } from '../../scripts/apple-judge';
import { abbreviate, roundRobin, type AppleQuery } from '../../scripts/apple-queries';
import { rng } from '../sim/random';

const square: Polygon[] = [[[[29, 41], [29.1, 41], [29.1, 41.1], [29, 41.1], [29, 41]]]] as unknown as Polygon[];
const ctx: Context = { plate: '34', province: 'İstanbul', districts: new Map([['Kadıköy', square]]), centres: new Map([['Kadıköy', [29.05, 41.05] as LngLat]]), hoods: new Map(), evidence: new Map([['kadikoy|bagdat', [[29.05, 41.05] as LngLat]]]), streets: new Map() };

const query = (over: Partial<AppleQuery> = {}): AppleQuery => ({ id: 'q-34-000', plate: '34', set: 'kapi', text: 'Bağdat Caddesi No:5 Kadıköy İstanbul', district: 'Kadıköy', center: [29.05, 41.05], hood: null, street: 'Bağdat Caddesi', number: '5', truth: [29.05, 41.05], ours: { status: 'resolved', level: 'ilçe', source: 'derived', precision: 'district', approximate: true, coordinate: [29.08, 41.08] }, ...over });
const raw = (over: Record<string, unknown> = {}): Raw => ({ id: 'q-34-000', status: 'ok', results: [{ lat: 41.0501, lng: 29.0501, thoroughfare: 'Bağdat Cd.', subThoroughfare: '5', administrativeArea: 'İstanbul', radius: 70, ...over }] });

describe('apple text helpers', () => {
  it('expands the short forms Apple returns', () => {
    expect(expandShort('Cumhuriyet Cd.')).toBe('Cumhuriyet Caddesi');
    expect(expandShort('Gül Sk.')).toBe('Gül Sokak');
    expect(expandShort('Atatürk Blv.')).toBe('Atatürk Bulvarı');
  });

  it('compares streets by key across short forms and kinds, never by similar spelling', () => {
    expect(sameStreet('Bağdat Cd.', 'Bağdat Caddesi')).toBe(true);
    expect(sameStreet('Ekinci Sk.', 'Ekici Sokak')).toBe(false);
    expect(sameStreet(null, 'Bağdat Caddesi')).toBe(false);
  });

  it('matches house numbers by their leading integer', () => {
    expect(numbersMatch('5', '5')).toBe(true);
    expect(numbersMatch('5/A', '5')).toBe(true);
    expect(numbersMatch('5', '7')).toBe(false);
    expect(numbersMatch('5', undefined)).toBe(false);
    expect(numbersMatch(null, undefined)).toBe(true);
  });

  it('measures the share of wanted name words found', () => {
    expect(nameOverlap('Öz Erciyes Eczanesi', 'Öz Erciyes Eczanesi')).toBe(1);
    expect(nameOverlap('Öz Erciyes Eczanesi', 'Erciyes Hastanesi')).toBeCloseTo(1 / 3);
  });

  it('knows a point inside or near a district, and one far away', () => {
    expect(insideBuffered([29.05, 41.05], square, 0)).toBe(true);
    expect(insideBuffered([29.1005, 41.05], square, 100)).toBe(true);
    expect(insideBuffered([29.5, 41.5], square, 1000)).toBe(false);
  });
});

describe('judgeOne', () => {
  it('takes a door answer that agrees on province, district, street and number as tier A when the directory backs it', () => {
    const j = judgeOne(query(), raw(), ctx);
    expect(j).toMatchObject({ tier: 'A', grain: 'door', cls: 'apple' });
    expect(j.errApple).toBeLessThan(20);
  });

  it('keeps a door answer without directory backing at tier B', () => {
    const j = judgeOne(query(), raw({ lat: 41.0502 }), { ...ctx, evidence: new Map() });
    expect(j.tier).toBe('B');
  });

  it('falls to street grain when the number differs, and rejects another street, district or province', () => {
    expect(judgeOne(query(), raw({ subThoroughfare: '9' }), ctx)).toMatchObject({ tier: 'C', grain: 'street' });
    expect(judgeOne(query(), raw({ thoroughfare: 'Ekinci Sk.' }), ctx)).toMatchObject({ tier: 'D', cls: 'supheli' });
    expect(judgeOne(query(), raw({ lat: 41.6, lng: 29.9 }), ctx).why).toContain('ilçe');
    expect(judgeOne(query(), raw({ administrativeArea: 'Ankara' }), ctx).why).toContain('il');
  });

  it('does not count an OSM door we already have against us, and calls close answers the same', () => {
    const ours = { status: 'resolved', level: 'kapı', source: 'osm', precision: 'address', approximate: false, coordinate: [29.05, 41.05] as LngLat };
    expect(judgeOne(query({ ours }), raw(), ctx).cls).toBe('ayni');
    expect(judgeOne(query({ ours }), raw({ lat: 41.06 }), ctx).cls).toBe('biz');
  });

  it('marks a street our product sent to another street as one Apple can fix', () => {
    const wrong = { status: 'resolved', level: 'sokak', source: 'derived', precision: 'street', approximate: true, coordinate: [29.09, 41.09] as LngLat };
    expect(judgeOne(query({ set: 'eksik', truth: null, ours: wrong }), raw(), ctx).cls).toBe('apple');
  });

  it('reports a missing or failed Apple answer without calling it better', () => {
    expect(judgeOne(query(), undefined, ctx).why).toEqual(['apple-yok']);
    expect(judgeOne(query(), { id: 'x', status: 'error' }, ctx).why).toEqual(['hata']);
    expect(judgeOne(query({ ours: { status: 'unresolved', level: null, source: null, precision: null, approximate: null, coordinate: null } }), { id: 'x', status: 'none' }, ctx).cls).toBe('ikisi-de-yok');
  });
});

describe('query helpers', () => {
  it('abbreviates street kinds', () => {
    expect(abbreviate('Gül Caddesi')).toBe('Gül Cd.');
    expect(abbreviate('Gül Sokağı')).toBe('Gül Sk.');
    expect(abbreviate('Gül')).toBe('Gül');
  });

  it('takes from every group in turn and stops at the count', () => {
    const groups = new Map([['a', [1, 2, 3]], ['b', [4, 5]], ['c', [6]]]);
    const out = roundRobin(groups, 4, rng(1));
    expect(out).toHaveLength(4);
    expect(new Set(out).size).toBe(4);
    expect(roundRobin(new Map([['a', [1]]]), 5, rng(1))).toEqual([1]);
  });
});
