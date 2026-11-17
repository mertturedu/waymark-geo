import { oracleSample, type OracleItem } from '../../scripts/export-oracle-queries';
import type { GoldenQuery } from '../../scripts/build-address-golden';

const query = (n: number, category: GoldenQuery['category'] = 'full'): GoldenQuery => ({ id: `34-${category}-${n}`, text: `sorgu ${n}`, category, lang: 'tr', expect: { plate: '34', osm: `n${n}`, number: String(n) } });

describe('oracleSample', () => {
  const pool = [...Array.from({ length: 100 }, (_, i) => query(i)), ...Array.from({ length: 20 }, (_, i) => query(200 + i, 'hard')), query(900, 'poi'), query(901, 'hide')];

  it('takes exactly the asked number from the full, folded and hard queries only', () => {
    const picked = oracleSample(pool, 40, 2026);
    expect(picked).toHaveLength(40);
    expect(new Set(picked.map((q) => q.id)).size).toBe(40);
    expect(picked.every((q) => ['full', 'folded', 'hard'].includes(q.category))).toBe(true);
  });

  it('picks the same ones for the same seed and others for another seed', () => {
    expect(oracleSample(pool, 40, 2026).map((q) => q.id)).toEqual(oracleSample(pool, 40, 2026).map((q) => q.id));
    expect(oracleSample(pool, 40, 2027).map((q) => q.id)).not.toEqual(oracleSample(pool, 40, 2026).map((q) => q.id));
  });

  it('gives everything when there are fewer than asked and skips conflicting queries', () => {
    expect(oracleSample(pool.slice(0, 5), 40, 1)).toHaveLength(5);
    expect(oracleSample([{ ...query(1), conflict: true }, query(2)], 40, 1).map((q) => q.id)).toEqual(['34-full-2']);
  });

  it('has the shape the comparison tool reads', () => {
    const item: OracleItem = { id: 'a', plate: '34', text: 't', truth: [28.6, 40.7], sdk: { status: 'resolved', precision: 'address', approximate: false, coordinate: [28.6, 40.7] } };
    expect(Object.keys(item).sort()).toEqual(['id', 'plate', 'sdk', 'text', 'truth']);
  });
});
