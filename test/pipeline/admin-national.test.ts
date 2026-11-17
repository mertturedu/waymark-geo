import { assignNearest, convexHull, grownHull, officialName, reconcilePlate, SOURCE_OFFICIAL, SOURCE_OSM_ONLY, SOURCE_SETTLEMENT, unitKeyOf } from '../../pipeline/build/admin-national';
import { osmSid, unitSid } from '../../pipeline/build/sid';
import type { Point, Polygon } from '../../src/core/region/geom';

const square = (x: number, y: number, size: number): Polygon[] => [[[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]];
const district = { id: 'r1', name: 'Merkez İlçe', rings: square(30, 40, 1) };

describe('officialName', () => {
  it('köy ekini ve parantezli köy adını ayıklar', () => {
    expect(officialName('Kozlu Köyü')).toBe('Kozlu');
    expect(officialName('Kendisi Mah (altınbaş Köyü)')).toBe('altınbaş');
    expect(officialName('Köyün Kendisi')).toBeNull();
    expect(officialName('Kendisi')).toBeNull();
  });
});

describe('sid', () => {
  it('OSM kimliği ve ad anahtarı kararlıdır', () => {
    expect(osmSid('34', 'r12345')).toBe('H34R12345');
    expect(unitSid('34', 'adalar', 'maden')).toBe(unitSid('34', 'adalar', 'maden'));
    expect(unitSid('34', 'adalar', 'maden')).not.toBe(unitSid('34', 'adalar', 'nizam'));
  });
});

describe('hull', () => {
  it('dışbükey zarfı bulur', () => {
    const hull = convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]);
    expect(hull).toHaveLength(4);
  });

  it('tek noktada bile alan üretir', () => {
    const [polygon] = grownHull([], [30.5, 40.5]);
    expect((polygon?.[0]?.length ?? 0) > 4).toBe(true);
  });
});

describe('assignNearest', () => {
  it('binayı en yakın tohuma verir, alınmış yeri atlar', () => {
    const seeds = [{ id: 'a', at: [30.5, 40.5] as Point }, { id: 'b', at: [30.52, 40.5] as Point }];
    const out = assignNearest(seeds, [[30.5005, 40.5], [30.5195, 40.5], [31.5, 41.5], [30.5, 40.5005]], (p) => p[1] > 40.5004);
    expect(out.get('a')).toHaveLength(1);
    expect(out.get('b')).toHaveLength(1);
  });
});

describe('reconcilePlate', () => {
  const hoods = [{ id: 'r10', district: 'r1', name: 'Atatürk Mahallesi', rings: square(30.1, 40.1, 0.1) }];
  const base = { plate: '99', districts: [district], hoods };

  it('eşleşen mahalleye resmi bayrak ve sid işler, yeni birimler açar', () => {
    const official = { 'Merkez İlçe': [['Atatürk', 3], ['Kozlu', 1], ['Yeniköy', 3], ['Uzak', 2]] as [string, number][] };
    const seeds = [
      { id: 'n1', kind: 'village', name: 'Kozlu', lon: 30.5, lat: 40.5 },
      { id: 'n2', kind: 'village', name: 'Dışarıköy', lon: 30.7, lat: 40.7 },
      { id: 'n3', kind: 'hamlet', name: 'Mezra', lon: 30.6, lat: 40.6 },
    ];
    const result = reconcilePlate({ ...base, official, seeds, buildings: [[30.5003, 40.5], [30.5, 40.5004]] });
    expect(result.marks).toEqual([{ hood: 'r10', sid: 'H99R10', official: 3 }]);
    const byName = new Map(result.units.map((u) => [u.name, u]));
    expect(byName.get('Kozlu')?.source).toBe(SOURCE_SETTLEMENT);
    expect(byName.get('Kozlu')?.rings).not.toBeNull();
    expect(byName.get('Yeniköy')?.source).toBe(SOURCE_OFFICIAL);
    expect(byName.get('Yeniköy')?.center).toBeNull();
    expect(byName.get('Dışarıköy')?.source).toBe(SOURCE_OSM_ONLY);
    expect(byName.has('Mezra')).toBe(false);
    expect(result.stats.officialUnits).toBe(4);
  });

  it('yazım farkı bir harfi geçmeyen adı eşler', () => {
    const official = { 'Merkez İlçe': [['Ataturkk', 1]] as [string, number][] };
    const result = reconcilePlate({ ...base, official, seeds: [] });
    expect(result.marks[0]?.official).toBe(1);
    expect(result.units).toHaveLength(0);
  });

  it('ilçe adı uyuşmazsa tek kalan ilçeyle eşler, aynı çalıştırma aynı kimlikleri verir', () => {
    const official = { Başka: [['Kozlu', 1]] as [string, number][] };
    const a = reconcilePlate({ ...base, official, seeds: [] });
    const b = reconcilePlate({ ...base, official, seeds: [] });
    expect(a.units[0]?.sid).toBe(b.units[0]?.sid);
    expect(a.stats.unmatchedDistricts).toEqual([]);
  });

  it('anahtar ek soymasını kullanır', () => {
    expect(unitKeyOf('Kozlu Köyü')).toBe(unitKeyOf('Kozlu'));
  });
});
