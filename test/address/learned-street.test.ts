import { learnedStreet, learnedStreetsInProvince, needsLearnedStreet, needsProvinceStreet, LEARNED_STREET_SCORE } from '../../src/core/address/learned-street';
import type { RegionContext, Scored } from '../../src/core/address/resolve';
import type { Place, PointLayer } from '../../src/core/address/types';
import type { ParsedAddress } from '../../src/core/text/types';

const parsed = (over: Partial<ParsedAddress> = {}): ParsedAddress => ({
  input: 'Yeni Sokak 9 Kadıköy',
  language: 'tr',
  province: null,
  district: { id: '34:1', name: 'Kadıköy', ambiguous: false },
  neighbourhood: null,
  street: { text: 'yeni', key: 'yeni', compact: 'yeni', kind: 'sokak', number: null },
  secondStreet: null,
  houseNumber: '9',
  building: null,
  block: null,
  floor: null,
  door: null,
  poiName: null,
  postcode: null,
  leftover: [],
  dropped: [],
  alternatives: [],
  ...over,
} as ParsedAddress);

const scored = (precision: Place['precision'], components: Place['components']): Scored => ({ score: 1, area: 'x', place: { id: 'p', label: 'p', components, coordinate: [29, 41], precision, approximate: false, source: 'osm', confidence: 1, region: '34' } });

const layerWith = (hints: { name: string; kindOnly?: boolean }[]): PointLayer => ({
  name: 'learned',
  lookup: async () => null,
  hints: async (_region, district) => hints.map((h) => ({ district, name: h.name, point: [29.1, 41.1] as [number, number], radiusM: 50, sources: 3 })),
});

const context = (layers: PointLayer[]): RegionContext => ({ region: { id: '34' } as never, provinceName: 'İstanbul', official: new Map(), layers, language: 'tr', findDistrictId: () => null });

describe('needsLearnedStreet', () => {
  it('is false without a typed street or a typed district', () => {
    expect(needsLearnedStreet([], parsed({ street: null }))).toBe(false);
    expect(needsLearnedStreet([], parsed({ district: null }))).toBe(false);
  });

  it('is true when nothing street level was found in the typed district under that name', () => {
    expect(needsLearnedStreet([], parsed())).toBe(true);
    expect(needsLearnedStreet([scored('district', { district: 'Kadıköy' })], parsed())).toBe(true);
    expect(needsLearnedStreet([scored('street', { district: 'Üsküdar', street: 'Yeni Sokak' })], parsed())).toBe(true);
    expect(needsLearnedStreet([scored('street', { district: 'Kadıköy', street: 'Eski Sokak' })], parsed())).toBe(true);
  });

  it('is false when the map already has the street in that district', () => {
    expect(needsLearnedStreet([scored('street', { district: 'Kadıköy', street: 'Yeni Sokak' })], parsed())).toBe(false);
    expect(needsLearnedStreet([scored('address', { district: 'KADIKÖY', street: 'yeni sokak', houseNumber: '9' })], parsed())).toBe(false);
  });
});

describe('learnedStreet', () => {
  it('returns nothing without a street or a district, or without a layer that has hints', async () => {
    expect(await learnedStreet(context([layerWith([{ name: 'Yeni Sokak' }])]), parsed({ street: null }))).toBeNull();
    expect(await learnedStreet(context([layerWith([{ name: 'Yeni Sokak' }])]), parsed({ district: null }))).toBeNull();
    expect(await learnedStreet(context([{ name: 'learned', lookup: async () => null }]), parsed())).toBeNull();
    expect(await learnedStreet(context([]), parsed())).toBeNull();
  });

  it('matches by the parsed street key, and by kind only when both sides have one', async () => {
    const place = await learnedStreet(context([layerWith([{ name: 'Başka Sokak' }, { name: 'Yeni Sokak' }])]), parsed());
    expect(place).toMatchObject({ score: LEARNED_STREET_SCORE, place: { source: 'learned', precision: 'street', approximate: true, radiusM: 50, components: { street: 'Yeni Sokak', houseNumber: '9', district: 'Kadıköy' } } });
    const noKind = await learnedStreet(context([layerWith([{ name: 'Yeni' }])]), parsed());
    expect(noKind?.place.components.street).toBe('Yeni');
    expect(await learnedStreet(context([layerWith([{ name: 'Yeni Caddesi' }])]), parsed())).toBeNull();
  });

  it('leaves the house number out when none was typed', async () => {
    const place = await learnedStreet(context([layerWith([{ name: 'Yeni Sokak' }])]), parsed({ houseNumber: null }));
    expect(place?.place.components.houseNumber).toBeUndefined();
  });
});

describe('learnedStreet with a typed neighbourhood', () => {
  const hoodScored = (name: string, coordinate: [number, number]): Scored => ({ ...scored('neighbourhood', { neighbourhood: name }), place: { ...scored('neighbourhood', { neighbourhood: name }).place, coordinate } });

  it('skips a hint that lies far from the typed neighbourhood', async () => {
    const out = await learnedStreet(context([layerWith([{ name: 'Yeni Sokağı' }])]), parsed({ neighbourhood: 'Durak' }), [hoodScored('Durak', [29.5, 41.1])]);
    expect(out).toBeNull();
  });

  it('keeps a hint inside the typed neighbourhood and when none is typed', async () => {
    const layers = [layerWith([{ name: 'Yeni Sokağı' }])];
    expect(await learnedStreet(context(layers), parsed({ neighbourhood: 'Durak' }), [hoodScored('Durak', [29.11, 41.1])])).not.toBeNull();
    expect(await learnedStreet(context(layers), parsed(), [])).not.toBeNull();
  });
});

describe('learnedStreet with a street line', () => {
  const wayHint = (): PointLayer => ({
    name: 'learned',
    lookup: async () => null,
    hints: async (_region, district) => [{ district, name: 'Yeni Sokağı', point: [29.1, 41.1] as [number, number], radiusM: 300, sources: 8, way: { line: [[29.1, 41.1], [29.102, 41.1]] as [number, number][], doors: [[1, 20], [3, 60], [5, 100], [7, 140], [9, 180]] as [number, number][] } }],
  });

  it('puts a numbered query at the interpolated spot and marks it interpolated', async () => {
    const out = await learnedStreet(context([wayHint()]), parsed({ houseNumber: '5' }));
    expect(out?.place.precision).toBe('interpolated');
    expect(out?.place.approximate).toBe(true);
    expect(out?.place.coordinate[0]).toBeGreaterThan(29.1);
    expect(out?.place.radiusM).toBe(250);
  });

  it('stays at the street level without a house number', async () => {
    const out = await learnedStreet(context([wayHint()]), parsed({ houseNumber: null }));
    expect(out?.place.precision).toBe('street');
    expect(out?.place.coordinate).toEqual([29.1, 41.1]);
  });
});


describe('learnedStreet in a centre district', () => {
  const merkez = (layers: PointLayer[]): RegionContext => ({ ...context(layers), region: { id: '13', districts: [{ id: 4, name: 'Bitlis Merkez', key: 'bitlis merkez', center: [42.1, 38.4] }] } as never, official: new Map([[4, '13:4']]) });
  const onlyFor = (key: string): PointLayer => ({
    name: 'learned',
    lookup: async () => null,
    hints: async (_region, district) => (district === key ? [{ district, name: 'Yeni Sokak', point: [42.1, 38.4] as [number, number], radiusM: 200, sources: 3 }] : []),
  });
  const typed = parsed({ district: { id: '13:4', name: 'Merkez', ambiguous: false } });

  it('finds the hint under the pack district name, not the typed short name', async () => {
    const place = await learnedStreet(merkez([onlyFor('bitlis merkez')]), typed);
    expect(place?.place.components).toMatchObject({ district: 'Bitlis Merkez', street: 'Yeni Sokak' });
  });

  it('still needs the hint when the other result sits in the pack district without that street', () => {
    expect(needsLearnedStreet([scored('street', { district: 'Bitlis Merkez', street: 'Eski Sokak' })], typed, merkez([]))).toBe(true);
    expect(needsLearnedStreet([scored('street', { district: 'Bitlis Merkez', street: 'Yeni Sokak' })], typed, merkez([]))).toBe(false);
  });
});

describe('learnedStreetsInProvince', () => {
  const districts = [{ id: 1, name: 'Kadıköy', key: 'kadikoy', center: [29, 41] }, { id: 2, name: 'Üsküdar', key: 'uskudar', center: [29.1, 41] }, { id: 3, name: 'Beşiktaş', key: 'besiktas', center: [29.2, 41] }];
  const province = (layers: PointLayer[]): RegionContext => ({ ...context(layers), region: { id: '34', districts } as never });
  const byDistrict = (map: Record<string, number>): PointLayer => ({
    name: 'learned',
    lookup: async () => null,
    hints: async (_region, district) => (district in map ? [{ district, name: 'Yeni Sokak', point: [29, 41] as [number, number], radiusM: 300, sources: map[district]! }] : []),
  });
  const noDistrict = parsed({ district: null });

  it('is only for a street typed without a district that no other result has', () => {
    expect(needsProvinceStreet([], noDistrict)).toBe(true);
    expect(needsProvinceStreet([], parsed())).toBe(false);
    expect(needsProvinceStreet([], parsed({ district: null, street: null }))).toBe(false);
    expect(needsProvinceStreet([scored('street', { district: 'Kadıköy', street: 'Yeni Sokak' })], noDistrict)).toBe(false);
    expect(needsProvinceStreet([scored('district', { district: 'Kadıköy' })], noDistrict)).toBe(true);
  });

  it('returns the single district that has the street at full score', async () => {
    const found = await learnedStreetsInProvince(province([byDistrict({ uskudar: 3 })]), noDistrict);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ score: LEARNED_STREET_SCORE, place: { components: { district: 'Üsküdar', street: 'Yeni Sokak' }, source: 'learned' } });
  });

  it('lists several districts, best sourced first, at a lower score so the answer stays ambiguous', async () => {
    const found = await learnedStreetsInProvince(province([byDistrict({ kadikoy: 2, besiktas: 9 })]), noDistrict);
    expect(found.map((f) => f.place.components.district)).toEqual(['Beşiktaş', 'Kadıköy']);
    expect(found[0]!.score).toBeLessThan(LEARNED_STREET_SCORE);
  });

  it('finds nothing when a district was typed or no district has the street', async () => {
    expect(await learnedStreetsInProvince(province([byDistrict({ kadikoy: 2 })]), parsed())).toEqual([]);
    expect(await learnedStreetsInProvince(province([byDistrict({})]), noDistrict)).toEqual([]);
  });
});
