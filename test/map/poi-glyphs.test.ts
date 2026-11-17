import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import { BADGE_ICONS, GLYPH_NAMES, GLYPH_TABLE, glyphExpression, glyphFromName, glyphOf, groupExpression, NO_GLYPH, placeProps, RULES, tierExpression } from '../../src/native/map/poi-glyphs';
import { ICON_GROUPS } from '../../src/native/map/theme';

const root = join(__dirname, '../../src/native');

function evaluate(value: unknown, properties: Record<string, unknown>, type: 'string' | 'number' = 'string'): unknown {
  const parsed = expression.createExpression(value, { type, 'property-type': 'data-driven', expression: { interpolated: false, parameters: ['zoom', 'feature'] } } as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return parsed.value.evaluate({ zoom: 16 }, { type: 1, properties } as never);
}

describe('poi glyphs', () => {
  it('names every glyph once, with a theme group and a tier', () => {
    expect(new Set(GLYPH_NAMES).size).toBe(GLYPH_NAMES.length);
    for (const row of GLYPH_TABLE) {
      expect(ICON_GROUPS).toContain(row.group);
      expect([1, 2, 3, 4]).toContain(row.tier);
      expect(row.source).toMatch(/^(maki|temaki):[a-z_-]+$/);
    }
  });

  it('only rules that point at a known glyph', () => {
    for (const [glyph, keys] of RULES) {
      expect(GLYPH_NAMES).toContain(glyph);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(key).toMatch(/^[a-z_]+$/);
    }
  });

  it('ships a small tintable picture for every glyph', () => {
    const text = readFileSync(join(root, 'platform', 'badge-images.ts'), 'utf8');
    for (const name of BADGE_ICONS) {
      const file = join(root, 'map', 'icons', `${name}.png`);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(6_000);
      expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
      expect(text).toMatch(new RegExp(`'${name}': \\{ source: badge_[a-z_]+, sdf: true \\}`));
    }
  });

  const expected: [string, string | null, string | null][] = [
    ['restaurant', 'food', 'restaurant'],
    ['turkish_restaurant', 'food', 'restaurant'],
    ['fast_food_restaurant', 'food', 'fast-food'],
    ['cafe', 'food', 'cafe'],
    ['coffee_shop', 'food', 'cafe'],
    ['bakery', 'food', 'bakery'],
    ['bar', 'food', 'bar'],
    ['sports_bar', 'food', 'bar'],
    ['grocery_store', 'market', 'grocery'],
    ['shopping_mall', 'market', 'shop'],
    ['clothing_store', 'shop', 'clothing'],
    ['womens_clothing_store', 'shop', 'clothing'],
    ['jewelry_store', 'shop', 'jewelry'],
    ['flowers_and_gifts_store', 'shop', 'florist'],
    ['electronics_store', 'shop', 'phone'],
    ['mobile_phone_store', 'shop', 'phone'],
    ['furniture_store', 'shop', 'furniture'],
    ['hair_salon', 'shop', 'hairdresser'],
    ['beauty_salon', 'shop', 'beauty'],
    ['spa', 'other', 'spa'],
    ['gym', 'other', 'gym'],
    ['doctors_office', 'health', 'doctor'],
    ['dental_clinic', 'health', 'dentist'],
    ['hospital', 'health', 'hospital'],
    ['pharmacy', 'pharmacy', 'pharmacy'],
    ['atm', 'money', 'atm'],
    ['bank', 'money', 'bank'],
    ['bank_or_credit_union', 'money', 'bank'],
    ['automotive_repair', 'fuel', 'car-repair'],
    ['auto_dealer', 'fuel', 'car'],
    ['gas_station', 'fuel', 'fuel'],
    ['hotel', 'lodging', 'lodging'],
    ['elementary_school', 'public', 'school'],
    ['preschool', 'public', 'school'],
    ['college_university', 'public', 'college'],
    ['muslim_place_of_worship', 'worship', 'mosque'],
    ['church', 'worship', 'church'],
    ['park', 'other', 'park'],
    ['parking', 'other', 'parking'],
    ['historic_site', 'other', 'monument'],
    ['arts_and_entertainment', 'other', 'art-gallery'],
    ['government_office', 'public', 'town-hall'],
    ['freight_and_cargo_service', 'other', 'post'],
    ['real_estate_agent', 'other', null],
    ['real_estate_service', 'other', null],
    ['advertising_agency', 'other', null],
    ['professional_service', 'other', null],
    ['manufacturer', 'other', null],
    ['printing_service', 'other', null],
    ['party_and_event_planning', 'other', null],
    ['insurance_agency', 'other', null],
    ['attorney_or_law_firm', 'other', null],
    ['home_developer', 'other', null],
  ];

  it('picks a glyph for the common categories and hides office-type businesses', () => {
    for (const [category, group, glyph] of expected) expect([category, glyphOf(category, group)]).toEqual([category, glyph]);
  });

  it('matches whole words only', () => {
    expect(glyphOf('parking_lot', 'other')).toBe('parking');
    expect(glyphOf('barber_shop', 'shop')).toBe('hairdresser');
    expect(glyphOf('space_rental', 'other')).toBeNull();
    expect(glyphOf('blood_bank', 'health')).toBe('bank');
    expect(glyphOf('barbecue_restaurant', 'food')).toBe('restaurant');
  });

  it('falls back to the data group and then to nothing', () => {
    expect(glyphOf('quirky_unknown_kind', 'food')).toBe('restaurant');
    expect(glyphOf('quirky_unknown_kind', 'market')).toBe('grocery');
    expect(glyphOf('quirky_unknown_kind', 'other')).toBeNull();
    expect(glyphOf(null, undefined)).toBeNull();
  });

  it('gives the style expression the same answers as the plain function', () => {
    const glyph = glyphExpression();
    for (const [category, group] of expected) expect([category, evaluate(glyph, { cat: category, g: group })]).toEqual([category, glyphOf(category, group) ?? NO_GLYPH]);
    expect(evaluate(glyph, { g: 'other' })).toBe(NO_GLYPH);
  });

  it('derives the theme group and the tier from the glyph', () => {
    expect(evaluate(groupExpression(), { cat: 'cafe', g: 'food' })).toBe('food');
    expect(evaluate(groupExpression(), { cat: 'park', g: 'other' })).toBe('nature');
    expect(evaluate(groupExpression(), { cat: 'muslim_place_of_worship', g: 'worship' })).toBe('worship');
    expect(evaluate(tierExpression(), { cat: 'hospital', g: 'health' }, 'number')).toBe(1);
    expect(evaluate(tierExpression(), { cat: 'cafe', g: 'food' }, 'number')).toBe(4);
  });

  describe('values baked into the tiles', () => {
    const categories = [...new Set(RULES.flatMap(([, keys]) => keys as string[]))];
    const groups = ['health', 'pharmacy', 'safety', 'cargo', 'money', 'fuel', 'worship', 'lodging', 'market', 'food', 'public', 'shop', 'other'];

    it('names the glyph, tier and group of a category, with the same answer as the rules', () => {
      expect(placeProps('pharmacy', 'pharmacy')).toEqual({ k: 'pharmacy', t: 2, grp: 'pharmacy' });
      expect(placeProps('hospital', 'health')).toEqual({ k: 'hospital', t: 1, grp: 'health' });
      expect(placeProps('cafe', 'food')).toMatchObject({ k: glyphOf('cafe', 'food'), t: 4 });
      expect(placeProps(undefined, 'other')).toEqual({ k: NO_GLYPH, t: 0, grp: 'public' });
      expect(placeProps('', null)).toEqual({ k: NO_GLYPH, t: 0, grp: 'public' });
    });

    it('gives the same glyph, tier and group from the tile as the style works out itself, for every rule keyword and group', () => {
      let compared = 0;
      for (const category of [...categories, 'some_unknown_kind', '', 'x_pharmacy_y']) {
        for (const g of groups) {
          const plain = { cat: category, g };
          const props = placeProps(category, g);
          const bakedIn = { ...plain, ...props };
          expect(evaluate(glyphExpression(), bakedIn)).toBe(evaluate(glyphExpression(), plain));
          expect(evaluate(tierExpression(), bakedIn, 'number')).toBe(evaluate(tierExpression(), plain, 'number'));
          expect(evaluate(groupExpression(), bakedIn)).toBe(evaluate(groupExpression(), plain));
          compared += 1;
        }
      }
      expect(compared).toBeGreaterThan(500);
    });

    it('still works out the answer for tiles that carry no baked values', () => {
      expect(evaluate(glyphExpression(), { cat: 'pharmacy', g: 'pharmacy' })).toBe('pharmacy');
      expect(evaluate(tierExpression(), { cat: 'pharmacy', g: 'pharmacy' }, 'number')).toBe(2);
      expect(evaluate(groupExpression(), { cat: 'pharmacy', g: 'pharmacy' })).toBe('pharmacy');
    });

    it('trusts a value that is in the tile even if the category would say otherwise', () => {
      expect(evaluate(glyphExpression(), { cat: 'pharmacy', g: 'pharmacy', k: 'bank', t: 3, grp: 'money' })).toBe('bank');
    });
  });
});


describe('glyph from the name (audit of 2026-11)', () => {
  it.each([
    ['Hacı Şam Camii', 'real_estate_service', 'other', 'mosque'],
    ['Karapınar Çevre Camii', 'retirement_home', 'other', 'mosque'],
    ['İslik Kasabasi Yeni Cami', 'retirement_home', 'other', 'mosque'],
    ['Merkez Mescidi', 'shopping', 'shop', 'mosque'],
    ['Güneş ECZANESİ', 'home_developer', 'other', 'pharmacy'],
    ['Pamukkale Üniversitesi Hastanesi', 'educational_services', 'public', 'hospital'],
  ])('%s (%s) gets the %s glyph', (name, category, group, glyph) => {
    expect(placeProps(category, group, name).k).toBe(glyph);
  });

  it('keeps the category glyph when it says something definite', () => {
    expect(placeProps('restaurant', 'food', 'Camii Karşısı Lokantası').k).toBe(glyphOf('restaurant', 'food'));
    expect(placeProps('hotel', 'lodging', 'Cami Otel').k).toBe('lodging');
    expect(placeProps('cafe', 'food', 'Eczane Kafe').k).toBe(glyphOf('cafe', 'food'));
  });

  it('looks only at the last word and ignores case and punctuation', () => {
    expect(glyphFromName('Yeni CAMİİ')).toBe('mosque');
    expect(glyphFromName('Yeni Camii.')).toBe('mosque');
    expect(glyphFromName('Camii Sokağı')).toBeNull();
    expect(glyphFromName('Hastanesi Kantini')).toBeNull();
    expect(glyphFromName('')).toBeNull();
    expect(glyphFromName(null)).toBeNull();
    expect(glyphFromName(undefined)).toBeNull();
  });

  it('is not used when no name is given', () => {
    expect(placeProps('real_estate_service', 'other').k).toBe(NO_GLYPH);
  });
});
