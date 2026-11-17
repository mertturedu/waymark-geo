import { formatCount, renderCoverage, renderAssignment, type CoverageInput } from '../../scripts/coverage-report';
import type { AssignmentCheck } from '../../scripts/check-assignment';

const input: CoverageInput = {
  osmDate: '2026-10-20',
  tilesBuild: '20261022',
  provinces: [
    { plate: '34', name: 'İstanbul', doors: 43264, rows: 43264, streets: 26269, neighbourhoods: 974, places: 20696, packBytes: 13_350_000, tilesBytes: 68_900_000, source: 43692, rejected: { duplicate: 390, no_digit: 49 } },
    { plate: '10', name: 'Balıkesir', doors: 53204, rows: 53204, streets: 5767, neighbourhoods: 415, places: 2239, packBytes: 5_780_000, tilesBytes: 46_700_000, source: 56329, rejected: { duplicate: 3125 } },
    { plate: '01', name: 'Adana', doors: 0, rows: 0, streets: 100, neighbourhoods: 10, places: 5, packBytes: 200_000, tilesBytes: 20_000_000, source: 0, rejected: {} },
  ],
  districts: [
    { plate: '34', province: 'İstanbul', name: 'Kadıköy', doors: 5000, streets: 800, neighbourhoods: 40 },
    { plate: '34', province: 'İstanbul', name: 'Adalar', doors: 0, streets: 20, neighbourhoods: 5 },
    { plate: '10', province: 'Balıkesir', name: 'Altıeylül', doors: 9000, streets: 400, neighbourhoods: 30 },
  ],
  hoodSources: { '34': { polygon: 43261, tag: 1, place: 2, none: 0 }, '10': { polygon: 50992, tag: 384, place: 1792, none: 36 } },
};

describe('formatCount', () => {
  it('uses dots between thousands', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1.000');
    expect(formatCount(246410)).toBe('246.410');
    expect(formatCount(1234567)).toBe('1.234.567');
  });
});

describe('renderCoverage', () => {
  const text = renderCoverage(input);

  it('names the data it was built from', () => {
    expect(text).toContain('2026-10-20');
    expect(text).toContain('20261022');
  });

  it('has a row for every province with counts in Turkish format and the totals', () => {
    expect(text).toMatch(/\| 34 \| İstanbul \| 43\.264 \| 26\.269 \| 974 \| 20\.696 \| 13,4 \| 68,9 \|/);
    expect(text).toMatch(/\| Toplam \| \| 96\.468 \|/);
  });

  it('lists the districts of the priority provinces and flags the ones with no door number', () => {
    expect(text).toContain('| Kadıköy | 5.000 | 800 | 40 |');
    expect(text).toMatch(/Kapı numarası olmayan ilçeler[\s\S]*Adalar/);
  });

  it('explains what was rejected and how neighbourhoods were found', () => {
    expect(text).toMatch(/Reddedilenler[\s\S]*duplicate[\s\S]*3\.515/);
    expect(text).toMatch(/Mahalle kaynağı[\s\S]*İstanbul[\s\S]*100,0/);
    expect(text).toMatch(/Balıkesir[\s\S]*95,8/);
  });

  it('is plain text with no dashes in running prose', () => {
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('renderAssignment', () => {
  const check: AssignmentCheck = {
    province: { agree: 99, total: 100 },
    district: { agree: 90, total: 100 },
    neighbourhood: { agree: 70, total: 100 },
    hoodSources: { polygon: 10, tag: 2, place: 1, none: 1 },
    skipped: { province: 5, district: 7 },
    unofficialDistrict: 3,
    mismatches: { province: [{ id: 'n1', tag: 'Ankara', assigned: '34', lon: 29, lat: 41 }], district: [], neighbourhood: [] },
  };
  const text = renderAssignment(check, { provinceMin: 99, districtMin: 95 });

  it('shows each rate against its threshold and whether it passed', () => {
    expect(text).toMatch(/İl uyumu[\s\S]*99,0[\s\S]*en az yüzde 99[\s\S]*geçti/);
    expect(text).toMatch(/İlçe uyumu[\s\S]*90,0[\s\S]*en az yüzde 95[\s\S]*kaldı/);
    expect(text).toMatch(/Mahalle uyumu[\s\S]*70,0[\s\S]*yalnızca rapor/);
  });

  it('lists the mismatches with their tag and the place', () => {
    expect(text).toContain('n1');
    expect(text).toContain('Ankara');
  });
});
