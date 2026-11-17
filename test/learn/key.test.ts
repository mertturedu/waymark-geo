import { composeKey, layerKeyOf, learnKey, streetPart } from '../../src/core/learn/key';
import { ALLOWED_CONFIRMATION_FIELDS, ALLOWED_FIELDS, SCHEMA_VERSION } from '../../src/core/learn/types';
import type { Place } from '../../src/core/address/types';

const place = (components: Place['components'], extra: Partial<Place> = {}): Place => ({
  id: '34:a:1', label: 'x', components, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra,
});

const moda = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '40' };

describe('learnKey', () => {
  it('builds plate, district, neighbourhood, street and number keys', () => {
    expect(learnKey(place(moda))).toBe('34|kadikoy|caferaga|moda~cadde|40');
  });

  it('does not depend on how the official names are cased or accented', () => {
    expect(learnKey(place({ ...moda, district: 'KADIKOY', neighbourhood: 'caferaga', street: 'MODA CADDESI' }))).toBe(learnKey(place(moda)));
  });

  it('separates the same street and number in two districts or two neighbourhoods', () => {
    expect(learnKey(place({ ...moda, district: 'Üsküdar' }))).not.toBe(learnKey(place(moda)));
    expect(learnKey(place({ ...moda, neighbourhood: 'Moda' }))).not.toBe(learnKey(place(moda)));
  });

  it('leaves the street part empty for a door without a street', () => {
    expect(learnKey(place({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', houseNumber: '7' }))).toBe('34|kadikoy|caferaga||7');
  });

  it('leaves the neighbourhood part empty when only the street is known', () => {
    expect(learnKey(place({ province: 'İstanbul', district: 'Kadıköy', street: 'Moda Caddesi', houseNumber: '40' }))).toBe('34|kadikoy||moda~cadde|40');
  });

  it('refuses places that cannot name a single door', () => {
    expect(learnKey(place({ ...moda, district: undefined }))).toBeNull();
    expect(learnKey(place({ ...moda, houseNumber: undefined }))).toBeNull();
    expect(learnKey(place({ ...moda, houseNumber: 'yok' }))).toBeNull();
    expect(learnKey(place({ province: 'İstanbul', district: 'Kadıköy', houseNumber: '40' }))).toBeNull();
    expect(learnKey(place(moda, { region: '' }))).toBeNull();
  });

  it('is built from the components only, never from the label', () => {
    expect(learnKey(place(moda, { label: 'Ahmet Yılmaz teslim' }))).toBe(learnKey(place(moda, { label: 'başka' })));
  });
});

describe('streetPart', () => {
  it('keeps the street kind so a caddesi and a sokak of one name stay apart', () => {
    expect(streetPart('moda', 'cadde')).toBe('moda~cadde');
    expect(streetPart('moda', 'sokak')).not.toBe(streetPart('moda', 'cadde'));
    expect(streetPart('moda', null)).toBe('moda');
    expect(streetPart('', 'cadde')).toBe('');
  });
});

describe('layerKeyOf', () => {
  it('gives the parts the resolver asks the layers with and agrees with learnKey', () => {
    expect(layerKeyOf('34', moda)).toEqual({ region: '34', district: 'kadikoy', neighbourhood: 'caferaga', street: 'moda~cadde', houseNumber: '40' });
    expect(composeKey(layerKeyOf('34', moda) as NonNullable<ReturnType<typeof layerKeyOf>>)).toBe(learnKey(place(moda)));
  });

  it('is null where learnKey is null', () => {
    expect(layerKeyOf('', moda)).toBeNull();
    expect(layerKeyOf('34', { ...moda, district: undefined })).toBeNull();
    expect(layerKeyOf('34', { province: 'İstanbul', district: 'Kadıköy', houseNumber: '40' })).toBeNull();
  });
});

describe('composeKey', () => {
  it('joins already folded parts and refuses separators inside them', () => {
    expect(composeKey({ region: '34', district: 'a', neighbourhood: '', street: 's', houseNumber: '1' })).toBe('34|a||s|1');
    expect(composeKey({ region: '34', district: 'a|b', neighbourhood: '', street: 's', houseNumber: '1' })).toBe('34|a b||s|1');
  });
});

describe('schema constants', () => {
  it('names the schema version and the only fields a record may carry', () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect([...ALLOWED_FIELDS].sort()).toEqual(['confirmations', 'key', 'region', 'text', 'v']);
    expect([...ALLOWED_CONFIRMATION_FIELDS].sort()).toEqual(['accuracyM', 'at', 'lat', 'lng', 'source']);
  });
});
