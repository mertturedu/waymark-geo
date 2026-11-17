import type { Place } from '../../src/core/address/types';
import { addressLines, hereText, placeCard } from '../../src/native/logic/place-card';
import { featureOf, loadPlaceCard, TIER_OF_GROUP } from '../../src/native/logic/place-pick-load';

const place = (components: Place['components']): Place => ({ id: '34:a:1', label: 'x', components, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34' });
const FULL = place({ neighbourhood: 'Caferağa Mah.', street: 'Moda Caddesi', houseNumber: '12', district: 'Kadıköy', province: 'İstanbul', postcode: '34710' });

describe('addressLines', () => {
  it('makes a street line and an area line', () => {
    expect(addressLines(FULL)).toEqual(['Moda Caddesi 12', 'Caferağa Mah., Kadıköy, İstanbul']);
  });

  it('skips what is missing and gives nothing for no place', () => {
    expect(addressLines(place({ district: 'Kadıköy' }))).toEqual(['Kadıköy']);
    expect(addressLines(place({ street: ' ', district: ' ' }))).toEqual([]);
    expect(addressLines(null)).toEqual([]);
  });
});

describe('placeCard', () => {
  it('shows the name, the group, the address and the postcode and a text to copy', () => {
    const card = placeCard({ name: 'Güneş Eczanesi', group: 'pharmacy', coordinate: [29, 41] }, FULL, 'tr');
    expect(card).toEqual({ title: 'Güneş Eczanesi', category: 'Eczaneler', lines: ['Moda Caddesi 12', 'Caferağa Mah., Kadıköy, İstanbul', '34710'], copyText: 'Güneş Eczanesi, Moda Caddesi 12, Caferağa Mah., Kadıköy, İstanbul', coordinate: [29, 41] });
  });

  it('falls back cleanly when the address, the group or the name is missing', () => {
    const bare = placeCard({ name: null, group: null, coordinate: [29, 41] }, null, 'en');
    expect(bare).toEqual({ title: 'No address information', category: null, lines: [], copyText: null, coordinate: [29, 41] });
    expect(placeCard({ name: 'X', group: 'unknown-group', coordinate: [1, 2] }, null, 'tr').category).toBeNull();
    expect(placeCard({ name: '  ', group: 'fuel', coordinate: [1, 2] }, place({ street: 'Atatürk Cd.' }), 'tr').title).toBe('Atatürk Cd.');
  });

  it('writes the category in the language asked for', () => {
    expect(placeCard({ name: 'A', group: 'fuel', coordinate: [1, 2] }, null, 'de').category).toBe('Tankstellen');
    expect(placeCard({ name: 'A', group: 'fuel', coordinate: [1, 2] }, null, 'ar').category).toBe('محطات الوقود');
  });
});

describe('hereText', () => {
  it('says what is near, in six languages', () => {
    expect(hereText(FULL, 'tr')).toBe('Caferağa Mah., Moda Caddesi 12 civarı');
    expect(hereText(FULL, 'en')).toBe('Near Caferağa Mah., Moda Caddesi 12');
    expect(hereText(FULL, 'de')).toBe('In der Nähe von Caferağa Mah., Moda Caddesi 12');
    expect(hereText(FULL, 'ru')).toBe('Около Caferağa Mah., Moda Caddesi 12');
  });

  it('is empty without a place or without a street and a neighbourhood', () => {
    expect(hereText(null, 'tr')).toBeNull();
    expect(hereText(place({ province: 'İstanbul' }), 'tr')).toBeNull();
    expect(hereText(place({ neighbourhood: 'Moda' }), 'tr')).toBe('Moda civarı');
  });
});

describe('featureOf', () => {
  const point = (properties: Record<string, unknown> | null, coordinates: unknown = [29, 41]) => ({ properties, geometry: { type: 'Point', coordinates } });

  it('reads the Turkish name before the plain name and the baked group before the data group', () => {
    expect(featureOf(point({ name: 'Pharmacy', 'name:tr': 'Eczane Güneş', grp: 'pharmacy', g: 'x' }))).toEqual({ name: 'Eczane Güneş', group: 'pharmacy', coordinate: [29, 41] });
    expect(featureOf(point({ name: 'Plain', g: 'fuel' }))).toEqual({ name: 'Plain', group: 'fuel', coordinate: [29, 41] });
    expect(featureOf(point(null))).toEqual({ name: null, group: null, coordinate: [29, 41] });
  });

  it('takes the group of a service badge from its kind when the tile gives none', () => {
    expect(featureOf(point({ name: 'QNB', kind: 'bank' }))).toEqual({ name: 'QNB', group: 'money', coordinate: [29, 41] });
    expect(featureOf(point({ name: 'Eczane', kind: 'pharmacy' }))?.group).toBe('pharmacy');
    expect(featureOf(point({ name: 'X', kind: 'no-such-kind' }))?.group).toBeNull();
  });

  it('refuses what is not a point with a real position', () => {
    expect(featureOf({ properties: {}, geometry: { type: 'LineString', coordinates: [[1, 2]] } })).toBeNull();
    expect(featureOf(point({}, [NaN, 41]))).toBeNull();
    expect(featureOf(point({}, 'x'))).toBeNull();
    expect(featureOf(point({}, ['a', 'b']))).toBeNull();
  });
});

describe('loadPlaceCard', () => {
  const at = (x: number, y: number) => ({ properties: { name: `P${x}`, grp: 'pharmacy' }, geometry: { type: 'Point', coordinates: [x, y] } });
  const deps = (reverse = async () => FULL as Place | null) => ({ project: ([lng]: [number, number]) => [lng * 10, 100] as [number, number], reverse, lang: 'tr' });

  it('opens the card of the badge nearest to the tap, within 24 px', async () => {
    const card = await loadPlaceCard(deps(), [at(10, 41), at(14, 41)], { x: 138, y: 100 });
    expect(card?.title).toBe('P14');
    expect(card?.lines[0]).toBe('Moda Caddesi 12');
  });

  it('gives nothing when no badge is that close or nothing is drawn', async () => {
    expect(await loadPlaceCard(deps(), [at(10, 41)], { x: 500, y: 500 })).toBeNull();
    expect(await loadPlaceCard(deps(), [], { x: 1, y: 1 })).toBeNull();
    expect(await loadPlaceCard(deps(), [{ properties: {}, geometry: { type: 'Polygon' } }], { x: 1, y: 1 })).toBeNull();
  });

  it('still shows the card when the address lookup fails', async () => {
    const card = await loadPlaceCard(deps(async () => Promise.reject(new Error('no pack'))), [at(10, 41)], { x: 100, y: 100 });
    expect(card).toMatchObject({ title: 'P10', lines: [], copyText: null });
  });

  it('prefers the more important group when two badges are equally near', async () => {
    const hospital = { properties: { name: 'Hastane', grp: 'health' }, geometry: { type: 'Point', coordinates: [9, 41] } };
    const cafe = { properties: { name: 'Kafe', grp: 'food' }, geometry: { type: 'Point', coordinates: [11, 41] } };
    expect((await loadPlaceCard(deps(), [cafe, hospital], { x: 100, y: 100 }))?.title).toBe('Hastane');
    expect(TIER_OF_GROUP.health).toBeLessThan(TIER_OF_GROUP.pharmacy!);
  });
});
