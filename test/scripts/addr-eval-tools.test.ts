import { checkUnit, stats } from '../../scripts/addr-eval';
import { makeRecord } from '../../scripts/addr-g2';
import { parseAddress } from '../../src/core/text';
import type { Door } from '../../scripts/addr-sets';

const door = (over: Partial<Door> = {}): Door => ({ id: '16:a:1', plate: '16', source: 'osm', lng: 28.95, lat: 40.22, province: 'Bursa', district: 'Nilüfer', hood: 'Fethiye', street: 'Gül Sokak', kind: 'sokak', number: '12', num: 12, ...over });

describe('makeRecord', () => {
  it('is deterministic for the same door', () => {
    expect(makeRecord(door(), ['Osmangazi'])).toEqual(makeRecord(door(), ['Osmangazi']));
  });

  it('keeps the door fields and lists the operators it applied', () => {
    for (let i = 0; i < 200; i++) {
      const record = makeRecord(door({ id: `16:a:${i}` }), ['Osmangazi', 'Yıldırım']);
      expect(record.number).toBe('12');
      expect(record.text.length).toBeGreaterThan(5);
      expect(new Set(record.ops).size).toBe(record.ops.length);
      if (record.unit?.door) expect(record.ops).toContain('unit');
      if (record.unit?.block) expect(record.ops).toContain('building');
    }
  });

  it('never drops both the neighbourhood and the district', () => {
    for (let i = 0; i < 300; i++) {
      const record = makeRecord(door({ id: `16:a:${i}` }), []);
      const folded = record.text.toLocaleLowerCase('tr-TR').replace(/[ıi]/g, 'i').replace(/ü/g, 'u');
      expect(/fethiye|fetiye|nilufer/.test(folded) || record.ops.includes('hood_typo')).toBe(true);
    }
  });
});

describe('checkUnit', () => {
  it('compares parsed floor, door and block with the expected unit', () => {
    const record = { ...door(), text: 'Gül Sk. No:12 Kat 3 Daire 7 Nilüfer', ops: ['unit'], unit: { floor: '3', door: '7' } };
    const parsed = parseAddress(record.text);
    expect(checkUnit(record)).toEqual({ floor: parsed.floor === '3', door: parsed.door === '7', block: null });
    expect(checkUnit({ ...door(), text: 'Gül Sk. 12', ops: [] })).toBeUndefined();
  });
});

describe('stats', () => {
  it('reports quantiles and shares within distances', () => {
    const result = stats([0, 5, 10, 20, 40, 60, 80, 100, 200, 400]);
    expect(result).toMatchObject({ count: 10, median: 60, within15: 30, within30: 40, within50: 50 });
    expect(stats([])).toMatchObject({ count: 0, median: 0, within30: 0 });
  });
});
