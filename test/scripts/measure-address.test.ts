import { distanceM } from '../../src/core/geo/distance';
import type { Place, ResolveResult } from '../../src/core/address/types';
import { checkNumbered, isAddressMatch, isPlaceMatch, offsetPoint, rankOf, sameAnswer, summarize, verdict, withinRank } from '../../scripts/measure-address';

const place = (id: string, extra: Partial<Place> = {}): Place => ({
  id, label: id, components: { street: 'Bahariye Caddesi', houseNumber: '14' }, coordinate: [28.6, 40.7], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra,
});

const resolved = (...places: Place[]): ResolveResult => ({ status: 'resolved', best: places[0] as Place, candidates: places });
const ambiguous = (...places: Place[]): ResolveResult => ({ status: 'ambiguous', candidates: places });

describe('rankOf', () => {
  it('counts from one and stops at the first match', () => {
    const result = resolved(place('a'), place('b'), place('c'));
    expect(rankOf(result, (p) => p.id === 'a')).toBe(1);
    expect(rankOf(result, (p) => p.id === 'c')).toBe(3);
  });

  it('is null when nothing matches or there is nothing to look at', () => {
    expect(rankOf(resolved(place('a')), () => false)).toBeNull();
    expect(rankOf({ status: 'not_found', candidates: [] }, () => true)).toBeNull();
    expect(rankOf({ status: 'region_missing', regions: ['34'] }, () => true)).toBeNull();
  });

  it('looks into the candidates of an ambiguous answer too', () => {
    expect(rankOf(ambiguous(place('a'), place('b')), (p) => p.id === 'b')).toBe(2);
  });
});

describe('summarize and verdict', () => {
  it('counts how many were right first and within five', () => {
    expect(summarize([1, 1, 3, null, 6, 2])).toEqual({ total: 6, first: 2, top5: 4 });
    expect(summarize([])).toEqual({ total: 0, first: 0, top5: 0 });
  });

  it('passes on the exact edge and fails just under, and never passes an empty set', () => {
    expect(verdict({ total: 100, first: 99, top5: 100 }, 99, null)).toBe(true);
    expect(verdict({ total: 100, first: 98, top5: 100 }, 99, null)).toBe(false);
    expect(verdict({ total: 100, first: 90, top5: 97 }, 90, 97)).toBe(true);
    expect(verdict({ total: 100, first: 90, top5: 96 }, 90, 97)).toBe(false);
    expect(verdict({ total: 0, first: 0, top5: 0 }, 99, null)).toBe(false);
  });
});

describe('isAddressMatch', () => {
  const expected = { osmRows: [{ id: 7, lng: 28.6, lat: 40.7 }], number: '14', streetName: 'Bahariye Caddesi' };

  it('accepts the very row', () => {
    expect(isAddressMatch(place('34:a:7'), '34', expected)).toBe(true);
  });

  it('accepts another row of the same street and number within thirty metres', () => {
    expect(isAddressMatch(place('34:a:9', { coordinate: [28.6001, 40.7] }), '34', expected)).toBe(true);
    expect(isAddressMatch(place('34:a:9', { coordinate: [28.601, 40.7] }), '34', expected)).toBe(false);
  });

  it('refuses another number, another street, a guess and another province', () => {
    expect(isAddressMatch(place('34:a:9', { components: { street: 'Bahariye Caddesi', houseNumber: '16' } }), '34', expected)).toBe(false);
    expect(isAddressMatch(place('34:a:9', { components: { street: 'Gül Sokak', houseNumber: '14' } }), '34', expected)).toBe(false);
    expect(isAddressMatch(place('34:g:9:14:1', { precision: 'interpolated', approximate: true }), '34', expected)).toBe(false);
    expect(isAddressMatch(place('06:a:7'), '34', expected)).toBe(false);
  });
});

describe('checkNumbered', () => {
  const numbered = (street: string, precision: Place['precision'] = 'street'): Place => place('x', { components: { street }, precision });

  it('lists streets whose number is not the one asked for', () => {
    expect(checkNumbered(resolved(numbered('1707. Sokak'), numbered('1708. Sokak')), 1707)).toEqual(['1708. Sokak']);
    expect(checkNumbered(ambiguous(numbered('1707. Sokak')), 1707)).toEqual([]);
  });

  it('ignores answers that are not a street or better', () => {
    expect(checkNumbered(resolved(numbered('1708. Sokak', 'neighbourhood')), 1707)).toEqual([]);
  });

  it('counts a street without a number as wrong too', () => {
    expect(checkNumbered(resolved(numbered('Gül Sokak')), 1707)).toEqual(['Gül Sokak']);
  });

  it('does not blame a street that is also known by the asked number', () => {
    const result = resolved(numbered('Şehit Murat Üçöz Caddesi'));
    expect(checkNumbered(result, 14)).toEqual(['Şehit Murat Üçöz Caddesi']);
    expect(checkNumbered(result, 14, () => ['Şehit Murat Üçöz Caddesi', '14. Sokak'])).toEqual([]);
    expect(checkNumbered(result, 15, () => ['Şehit Murat Üçöz Caddesi', '14. Sokak'])).toEqual(['Şehit Murat Üçöz Caddesi']);
  });

  it('accepts a street whose name spells out the asked number and not one that spells another', () => {
    expect(checkNumbered(resolved(numbered('Sekizinci Sokak'), numbered('Yirmi Birinci Sokak')), 8)).toEqual(['Yirmi Birinci Sokak']);
    expect(checkNumbered(resolved(numbered('Yirmi Birinci Sokak')), 21)).toEqual([]);
    expect(checkNumbered(resolved(numbered('Dokuzuncu Sokak')), 8)).toEqual(['Dokuzuncu Sokak']);
    expect(checkNumbered(resolved(numbered('Sekiz Eylül Sokak')), 8)).toEqual(['Sekiz Eylül Sokak']);
  });

  it('has nothing to report for answers without candidates', () => {
    expect(checkNumbered({ status: 'not_found', candidates: [] }, 5)).toEqual([]);
    expect(checkNumbered({ status: 'region_missing', regions: [] }, 5)).toEqual([]);
  });
});

describe('withinRank', () => {
  it('counts the ranks up to and including the limit, and never the missing ones', () => {
    expect(withinRank([1, 2, 3, 4, null, 5], 3)).toBe(3);
    expect(withinRank([], 3)).toBe(0);
    expect(withinRank([null, null], 3)).toBe(0);
  });
});

describe('isPlaceMatch', () => {
  const poi = (id: string, extra: Partial<Place> = {}): Place => place(id, { precision: 'poi', components: { poiName: 'Devlet Hastanesi' }, ...extra });

  it('accepts the very place', () => {
    expect(isPlaceMatch(poi('34:o:7'), '34', [7])).toBe(true);
  });

  it('refuses another place, another province and anything that is not a place', () => {
    expect(isPlaceMatch(poi('34:o:8'), '34', [7])).toBe(false);
    expect(isPlaceMatch(poi('06:o:7'), '34', [7])).toBe(false);
    expect(isPlaceMatch(place('34:o:7'), '34', [7])).toBe(false);
  });
});

describe('offsetPoint', () => {
  it('moves a point by the asked number of metres in the asked direction', () => {
    const start: [number, number] = [29.0, 41.0];
    for (const angle of [0, 1, 2.5, 4, 6]) expect(Math.abs(distanceM(start, offsetPoint(start, 80, angle)) - 80)).toBeLessThan(0.5);
    expect(offsetPoint(start, 0, 1)).toEqual(start);
    const east = offsetPoint(start, 100, Math.PI / 2);
    expect(east[0]).toBeGreaterThan(start[0]);
    expect(Math.abs(east[1] - start[1])).toBeLessThan(1e-9);
  });
});

describe('sameAnswer', () => {
  const answer = { plate: '34', districtId: 1, hoodId: 2, addressId: 3, streetId: 4 };

  it('says yes for equal answers and for two empty ones', () => {
    expect(sameAnswer(answer, { ...answer })).toBe(true);
    expect(sameAnswer(null, null)).toBe(true);
  });

  it('says no when any id differs or only one side is empty', () => {
    expect(sameAnswer(answer, { ...answer, addressId: 5 })).toBe(false);
    expect(sameAnswer(answer, { ...answer, hoodId: null })).toBe(false);
    expect(sameAnswer(answer, null)).toBe(false);
    expect(sameAnswer(null, answer)).toBe(false);
  });
});

describe('checkNumbered with a number spelled in one word', () => {
  it('accepts "Yirmibeş Sokak" for 25', () => {
    const result = { status: 'resolved', best: { components: { street: 'Yirmibeş Sokak' } }, candidates: [{ id: 'x', precision: 'street', components: { street: 'Yirmibeş Sokak' } }] } as never;
    expect(checkNumbered(result, 25)).toEqual([]);
  });
});
