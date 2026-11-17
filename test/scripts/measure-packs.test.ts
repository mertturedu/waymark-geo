import { encodeBorders, createBorders } from '../../src/core/region/borders';
import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareBorders, evaluateAccounting, evaluateAssignment, evaluateCounts, evaluateSizes, validationStamp } from '../../scripts/measure-packs';

const borders = createBorders(
  encodeBorders([
    { plate: '34', rings: [[[[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]]]] },
    { plate: '06', rings: [[[[32, 39.5], [33, 39.5], [33, 40.5], [32, 40.5], [32, 39.5]]]] },
  ]),
);

describe('compareBorders', () => {
  it('counts agreement, keeps the slack ones apart and lists examples', () => {
    const rows = [
      { id: 'n1', lon: 29, lat: 41, plate: '34', slack: false },
      { id: 'n2', lon: 32.5, lat: 40, plate: '06', slack: false },
      { id: 'n3', lon: 29, lat: 41, plate: '06', slack: false },
      { id: 'n4', lon: 28.4999, lat: 41, plate: '34', slack: true },
      { id: 'n5', lon: 10, lat: 10, plate: '34', slack: false },
    ];
    const result = compareBorders(borders, rows);
    expect(result).toMatchObject({ checked: 5, agree: 2, slackOutside: 1, disagree: 2 });
    expect(result.examples.map((e) => [e.id, e.got])).toEqual([['n3', '34'], ['n5', null]]);
  });

  it('keeps at most twenty examples', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, lon: 10, lat: 10, plate: '34', slack: false }));
    expect(compareBorders(borders, rows).examples).toHaveLength(20);
  });

  it('is fine with no rows', () => {
    expect(compareBorders(borders, [])).toEqual({ checked: 0, agree: 0, slackOutside: 0, disagree: 0, examples: [] });
  });
});

describe('evaluateAccounting', () => {
  const good = () => ({
    addresses: {
      filtered: false, outside: 2, skipped: 0, source: 20, unlocatable: 1,
      provinces: { '34': { source: 10, accepted: 8, rows: 9, rejected: { duplicate: 1, no_digit: 1 } }, '06': { source: 7, accepted: 7, rows: 7, rejected: {} } },
    },
    streets: { filtered: false, ways: 10, written: 8, rejected: { no_district: 1, outside: 1, unlocatable: 0 } },
    places: { filtered: false, source: 6, provinces: { '34': { accepted: 4 }, '06': { accepted: 1 } }, rejected: { no_district: 0, not_closed: 0, outside: 1 } },
    buildings: { elsewhere: 5, open: 1, outside: 3, provinces: { '34': { source: 4, accepted: 3, rejected: { degenerate: 1 } } } },
  });

  it('passes when every list adds up and says what it counted', () => {
    const result = evaluateAccounting(good());
    expect(result.pass).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.measured).toMatch(/adres 20 = 17 \+ 2 \+ 1/);
  });

  it.each([
    ['an address province that loses an object', (a: ReturnType<typeof good>) => (a.addresses.provinces['34'].accepted = 7), /adres 34/],
    ['an address total that does not match', (a: ReturnType<typeof good>) => (a.addresses.source = 21), /adres toplamı/],
    ['a street list that loses a way', (a: ReturnType<typeof good>) => (a.streets.written = 7), /sokak/],
    ['a place list that loses a place', (a: ReturnType<typeof good>) => (a.places.source = 7), /yer/],
    ['a building province that loses a building', (a: ReturnType<typeof good>) => (a.buildings.provinces['34'].accepted = 2), /bina 34/],
    ['a filtered run', (a: ReturnType<typeof good>) => (a.addresses.filtered = true), /süzülmüş/],
  ])('fails on %s', (_name, change, message) => {
    const accounting = good();
    change(accounting);
    const result = evaluateAccounting(accounting);
    expect(result.pass).toBe(false);
    expect(result.problems.join('\n')).toMatch(message);
  });
});

describe('evaluateCounts', () => {
  const fixture = [{ plate: '34', name: 'İstanbul', doors: 1000, tileMB: 79 }, { plate: '06', name: 'Ankara', doors: 500, tileMB: 80 }];
  const accounting = (a: number, b: number) => ({ provinces: { '34': { source: a }, '06': { source: b } } });

  it('passes inside one percent and names the largest difference', () => {
    const result = evaluateCounts(accounting(1009, 500), fixture, { packs: 81, errors: 0 });
    expect(result.pass).toBe(true);
    expect(result.measured).toMatch(/en büyük sapma yüzde 0,9/);
  });

  it('fails past one percent and when a pack is missing or the check found errors', () => {
    expect(evaluateCounts(accounting(1011, 500), fixture, { packs: 81, errors: 0 }).pass).toBe(false);
    expect(evaluateCounts(accounting(1000, 500), fixture, { packs: 80, errors: 0 }).pass).toBe(false);
    expect(evaluateCounts(accounting(1000, 500), fixture, { packs: 81, errors: 2 }).pass).toBe(false);
  });

  it('fails when a priority province is missing from the accounting', () => {
    expect(evaluateCounts({ provinces: { '34': { source: 1000 } } }, fixture, { packs: 81, errors: 0 }).pass).toBe(false);
  });
});

describe('evaluateSizes', () => {
  const fixture = [{ plate: '34', name: 'İstanbul', doors: 1, tileMB: 79 }, { plate: '06', name: 'Ankara', doors: 1, tileMB: 80 }];
  const manifest = (over: Partial<{ base: number; t34: number; t06: number; a34: number; a06: number; a01: number }> = {}) => {
    const v = { base: 12_000_000, t34: 69_000_000, t06: 52_000_000, a34: 13_000_000, a06: 6_000_000, a01: 30_000_000, ...over };
    return {
      base: [{ size: v.base }],
      regions: [
        { id: '34', files: [{ kind: 'tiles', size: v.t34 }, { kind: 'address', size: v.a34 }] },
        { id: '06', files: [{ kind: 'tiles', size: v.t06 }, { kind: 'address', size: v.a06 }] },
        { id: '01', files: [{ kind: 'address', size: v.a01 }] },
      ],
    };
  };

  it('passes within every limit and reports both address totals', () => {
    const result = evaluateSizes(manifest(), fixture, ['34', '06']);
    expect(result.pass).toBe(true);
    expect(result.measured).toMatch(/temel 12,0 MB/);
    expect(result.measured).toMatch(/12 il adres 19,0 MB/);
    expect(result.measured).toMatch(/81 il adres 49,0 MB/);
  });

  it.each([
    ['base over 30 MB', { base: 30_000_001 }, /temel/],
    ['a province over its own limit', { t34: 79_000_001 }, /34/],
    ['address total over 60 MB', { a34: 55_000_000 }, /adres/],
  ])('fails on %s', (_name, change, message) => {
    const result = evaluateSizes(manifest(change), fixture, ['34', '06']);
    expect(result.pass).toBe(false);
    expect(result.problems.join('\n')).toMatch(message);
  });

  it('fails when the twelve province tiles together pass 700 MB', () => {
    const wide = Array.from({ length: 12 }, (_, i) => ({ plate: String(i + 1).padStart(2, '0'), name: 'x', doors: 1, tileMB: 90 }));
    const big = { base: [{ size: 1 }], regions: wide.map((w) => ({ id: w.plate, files: [{ kind: 'tiles', size: 60_000_000 }, { kind: 'address', size: 1 }] })) };
    const result = evaluateSizes(big, wide, wide.map((w) => w.plate));
    expect(result.pass).toBe(false);
    expect(result.problems.join('\n')).toMatch(/700/);
  });
});

describe('evaluateAssignment', () => {
  const tally = (agree: number, total: number) => ({ agree, total });
  const check = (p: [number, number], d: [number, number]) => ({ province: tally(...p), district: tally(...d), neighbourhood: tally(1, 2), hoodSources: {}, skipped: { province: 0, district: 0 }, unofficialDistrict: 0, mismatches: { province: [], district: [], neighbourhood: [] } });

  it('passes on exactly 99 and 95 percent and fails just under', () => {
    expect(evaluateAssignment(check([99, 100], [95, 100])).pass).toBe(true);
    expect(evaluateAssignment(check([98, 100], [95, 100])).pass).toBe(false);
    expect(evaluateAssignment(check([99, 100], [94, 100])).pass).toBe(false);
  });

  it('fails when nothing could be compared', () => {
    expect(evaluateAssignment(check([0, 0], [0, 0])).pass).toBe(false);
  });
});

describe('evaluateSizes with missing provinces', () => {
  const fixture = [{ plate: '34', name: 'İstanbul', doors: 1, tileMB: 79 }, { plate: '06', name: 'Ankara', doors: 1, tileMB: 80 }];

  it('fails when a priority province is not in the manifest at all', () => {
    const manifest = { base: [{ size: 1 }], regions: [{ id: '34', files: [{ kind: 'tiles', size: 1 }, { kind: 'address', size: 1 }] }] };
    const result = evaluateSizes(manifest, fixture, ['34', '06']);
    expect(result.pass).toBe(false);
    expect(result.problems.join('\n')).toMatch(/06.*manifestte yok/);
  });

  it('fails when a province has no map or no address file', () => {
    const manifest = { base: [{ size: 1 }], regions: [{ id: '34', files: [{ kind: 'address', size: 1 }] }, { id: '06', files: [{ kind: 'tiles', size: 1 }] }] };
    const text = evaluateSizes(manifest, fixture, ['34', '06']).problems.join('\n');
    expect(text).toMatch(/34.*harita dosyası yok/);
    expect(text).toMatch(/06.*adres dosyası yok/);
  });
});

describe('evaluateCounts with the validated manifest', () => {
  it('counts the provinces the validation really saw', () => {
    const fixture = [{ plate: '34', name: 'İstanbul', doors: 100, tileMB: 79 }];
    const accounting = { provinces: { '34': { source: 100 } } };
    expect(evaluateCounts(accounting, fixture, { packs: 12, errors: 0 }).pass).toBe(false);
    expect(evaluateCounts(accounting, fixture, { packs: 12, errors: 0 }).measured).toMatch(/12 paket/);
  });
});

describe('validationStamp', () => {
  const make = () => {
    const root = mkdtempSync(join(tmpdir(), 'stamp-'));
    mkdirSync(join(root, '34'));
    writeFileSync(join(root, '34', 'a.sqlite'), 'aaaa');
    writeFileSync(join(root, 'base.bin'), 'bbbb');
    writeFileSync(join(root, 'manifest-v1.json'), JSON.stringify({ base: [{ path: 'base.bin' }], regions: [{ files: [{ path: '34/a.sqlite' }] }] }));
    return root;
  };

  it('stays the same while nothing changes', () => {
    const root = make();
    expect(validationStamp(root)).toBe(validationStamp(root));
  });

  it('changes when a listed file grows, is rewritten in place or disappears', () => {
    const root = make();
    const first = validationStamp(root);
    appendFileSync(join(root, '34', 'a.sqlite'), 'x');
    const second = validationStamp(root);
    expect(second).not.toBe(first);
    utimesSync(join(root, 'base.bin'), new Date(2020, 1, 1), new Date(2020, 1, 1));
    const third = validationStamp(root);
    expect(third).not.toBe(second);
    writeFileSync(join(root, 'manifest-v1.json'), JSON.stringify({ base: [], regions: [{ files: [{ path: '34/a.sqlite' }] }] }));
    expect(validationStamp(root)).not.toBe(third);
  });

  it('notices a missing file without throwing', () => {
    const root = make();
    const first = validationStamp(root);
    writeFileSync(join(root, 'manifest-v1.json'), JSON.stringify({ base: [{ path: 'gone.bin' }], regions: [] }));
    expect(() => validationStamp(root)).not.toThrow();
    expect(validationStamp(root)).not.toBe(first);
  });
});
