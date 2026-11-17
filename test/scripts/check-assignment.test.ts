import { checkAssignment, type AddressForCheck } from '../../scripts/check-assignment';

const names = {
  district: (id: string): string | null => ({ r1: 'Kadıköy', r2: 'Üsküdar', r3: 'Merkez', r4: 'Hayali Bölge', r5: 'Taşova' })[id] ?? null,
  hood: (id: string): string | null => ({ h1: 'Moda Mahallesi', h2: 'Fener Mahallesi' })[id] ?? null,
};

const row = (id: string, plate: string, district: string, tags: Record<string, string>, more: Partial<AddressForCheck> = {}): AddressForCheck => ({
  id, plate, district, neighbourhood: 'h1', hoodName: null, hoodSource: 'polygon', tags, lon: 29, lat: 41, ...more,
});

describe('checkAssignment', () => {
  it('counts the province and district a tag names when it is the one we assigned', () => {
    const result = checkAssignment([row('n1', '34', 'r1', { city: 'İstanbul', district: 'Kadıköy' })], names);
    expect(result.province).toEqual({ agree: 1, total: 1 });
    expect(result.district).toEqual({ agree: 1, total: 1 });
    expect(result.mismatches.province).toEqual([]);
  });

  it('keeps a mismatch with the tag text and what we assigned', () => {
    const result = checkAssignment([row('n1', '34', 'r1', { city: 'Ankara', district: 'Üsküdar' })], names);
    expect(result.province).toEqual({ agree: 0, total: 1 });
    expect(result.district).toEqual({ agree: 0, total: 1 });
    expect(result.mismatches.province[0]).toMatchObject({ id: 'n1', tag: 'Ankara', assigned: '34' });
    expect(result.mismatches.district[0]).toMatchObject({ id: 'n1', tag: 'Üsküdar', assigned: 'Kadıköy' });
  });

  it('reads the province from addr:province before addr:city and the district from addr:district before addr:city', () => {
    const result = checkAssignment([row('n1', '34', 'r1', { province: 'İstanbul', city: 'Kadıköy' })], names);
    expect(result.province).toEqual({ agree: 1, total: 1 });
    expect(result.district).toEqual({ agree: 1, total: 1 });
  });

  it('skips a row whose tags name nothing we know and tells how many', () => {
    const result = checkAssignment([row('n1', '34', 'r1', {}), row('n2', '34', 'r1', { city: 'Bilinmeyen Yer', district: 'Yokluk' })], names);
    expect(result.province.total).toBe(0);
    expect(result.district.total).toBe(0);
    expect(result.skipped).toEqual({ province: 2, district: 2 });
  });

  it('accepts a district name that exists in several provinces when one of them is the assigned one', () => {
    const result = checkAssignment([row('n1', '05', 'r3', { district: 'Merkez' }), row('n2', '05', 'r5', { district: 'Merkez' })], names);
    expect(result.district).toEqual({ agree: 1, total: 2 });
    expect(result.mismatches.district.map((m) => m.id)).toEqual(['n2']);
  });

  it('reads names written in another language or without Turkish letters', () => {
    const result = checkAssignment([row('n1', '34', 'r1', { city: 'Istanbul', district: 'KADIKOY' })], names);
    expect(result.province).toEqual({ agree: 1, total: 1 });
    expect(result.district).toEqual({ agree: 1, total: 1 });
  });

  it('counts rows assigned to a district the official list does not have and leaves them out of the tally', () => {
    const result = checkAssignment([row('n1', '34', 'r4', { district: 'Kadıköy' })], names);
    expect(result.district).toEqual({ agree: 0, total: 0 });
    expect(result.unofficialDistrict).toBe(1);
  });

  it('compares the neighbourhood by name without the neighbourhood word and ignores rows whose name came from the tag itself', () => {
    const rows = [
      row('n1', '34', 'r1', { neighbourhood: 'Moda Mah.' }),
      row('n2', '34', 'r1', { neighbourhood: 'Fener' }),
      row('n3', '34', 'r1', { suburb: 'Moda' }),
      row('n4', '34', 'r1', { neighbourhood: 'Bahariye' }, { neighbourhood: null, hoodName: 'Bahariye', hoodSource: 'tag' }),
      row('n5', '34', 'r1', { neighbourhood: 'Bahariye Mahallesi' }, { neighbourhood: null, hoodName: 'Bahariye', hoodSource: 'place' }),
    ];
    const result = checkAssignment(rows, names);
    expect(result.neighbourhood).toEqual({ agree: 3, total: 4 });
    expect(result.mismatches.neighbourhood.map((m) => m.id)).toEqual(['n2']);
  });

  it('counts the way each neighbourhood was found', () => {
    const rows = [row('n1', '34', 'r1', {}), row('n2', '34', 'r1', {}, { hoodSource: 'tag' }), row('n3', '34', 'r1', {}, { hoodSource: 'place' }), row('n4', '34', 'r1', {}, { hoodSource: 'none' }), row('n5', '34', 'r1', {})];
    expect(checkAssignment(rows, names).hoodSources).toEqual({ none: 1, place: 1, polygon: 2, tag: 1 });
  });

  it('keeps at most fifty examples for each level', () => {
    const rows = Array.from({ length: 80 }, (_, i) => row(`n${i}`, '34', 'r1', { city: 'Ankara', district: 'Üsküdar', neighbourhood: 'Fener' }));
    const result = checkAssignment(rows, names);
    expect(result.province.total).toBe(80);
    expect(result.mismatches.province).toHaveLength(50);
    expect(result.mismatches.district).toHaveLength(50);
    expect(result.mismatches.neighbourhood).toHaveLength(50);
  });
});
