import { parseAddress } from '../../src/core/text';
import type { Lang } from '../../src/core/text/types';
import { standardAddress } from '../../src/core/address/standard';
import type { Place, ResolveResult } from '../../src/core/address/types';
import { analyse } from '../../src/core/address/validate';
import { kindText, noteText, NOTE_CODES, PRECISIONS, statusText, STATUSES } from '../../src/core/address/validate-text';

const LANGS: Lang[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

const place = (over: Partial<Place> = {}): Place => ({
  id: '34:a:1', label: 'x', components: { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Bahariye Caddesi', houseNumber: '14' }, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 0.97, region: '34', ...over,
});
const resolved = (best: Place, others: Place[] = []): ResolveResult => ({ status: 'resolved', best, candidates: [best, ...others] });
const check = (text: string, result: ResolveResult, language: Lang = 'tr', suggestions = {}) => analyse({ parsed: parseAddress(text), result, language, suggestions });
const codes = (v: ReturnType<typeof check>): string[] => v.notes.map((n) => n.code);

describe('texts', () => {
  it('has every note, kind and status in all six languages, with no placeholder left', () => {
    for (const lang of LANGS) {
      for (const code of NOTE_CODES) {
        const text = noteText(code, lang, { given: 'A', found: 'B' });
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toMatch(/[{}]/);
      }
      for (const precision of PRECISIONS) expect(kindText(precision, lang).length).toBeGreaterThan(1);
      for (const status of STATUSES) expect(statusText(status, lang).length).toBeGreaterThan(3);
    }
  });

  it('fills the given and found names', () => {
    expect(noteText('district_mismatch', 'tr', { given: 'Üsküdar', found: 'Kadıköy' })).toBe('Yazılan ilçe (Üsküdar) ile adres uyuşmuyor; adres Kadıköy ilçesinde bulundu.');
    expect(noteText('street_not_in_neighbourhood', 'en', { given: 'Moda', found: 'Caferağa' })).toContain('Moda');
    expect(noteText('district_mismatch', 'en')).toBe('The district you wrote () does not match; the address was found in .');
    expect(noteText('district_mismatch', 'en', { given: 'A' })).toContain('(A)');
    expect(noteText('district_mismatch', 'en', { found: 'B' })).toContain('in B');
  });
});

describe('standardAddress', () => {
  const door = place({ components: { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Bahariye Caddesi', houseNumber: '14', postcode: '34710' } });

  it('writes street and number, neighbourhood with postcode, then district and province', () => {
    expect(standardAddress(door, 'tr').text).toBe('Bahariye Caddesi No:14, Caferağa Mah. 34710, Kadıköy/İstanbul');
    expect(standardAddress(door, 'en').text).toBe('14 Bahariye Caddesi, Caferağa 34710, Kadıköy, İstanbul');
    expect(standardAddress(door, 'ru').text).toBe('Bahariye Caddesi, 14, Caferağa 34710, Kadıköy, İstanbul');
    expect(standardAddress(door, 'de').text).toBe('Bahariye Caddesi 14, Caferağa 34710, Kadıköy, İstanbul');
    expect(standardAddress(door, 'ar').text).toContain('، ');
  });

  it('keeps the UAVT order of the parts and adds the unit line', () => {
    const unit = { block: { name: 'B', building: 1, center: null }, entrance: null, floor: { value: 3, low: 3, high: 3, source: 'written' as const }, door: '7', levels: 5, perFloor: 4, notes: [] };
    const full = standardAddress({ ...door, unit }, 'tr');
    expect(full.uavt).toEqual({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Bahariye Caddesi', number: '14', unit: 'B Blok, Kat 3, Daire 7' });
    expect(full.lines[1]).toBe('B Blok, Kat 3, Daire 7');
  });

  it('copes with a place name, a flat number without unit info and missing parts', () => {
    const named = standardAddress(place({ components: { province: 'İzmir', poiName: 'Kipa', door: '4' } }), 'tr');
    expect(named.lines).toEqual(['Kipa', 'Daire 4', 'İzmir']);
    expect(standardAddress(place({ components: { district: 'Bornova', door: '4' } }), 'en').uavt.unit).toBe('4');
    expect(standardAddress(place({ components: { houseNumber: '5', postcode: '35000' } }), 'tr').text).toBe('No:5, 35000');
    expect(standardAddress(place({ components: { street: 'Gül Sokak' } }), 'ru').text).toBe('Gül Sokak');
  });
});

describe('analyse', () => {
  it('says ok for a consistent address and names the kind and the standard form', () => {
    const v = check('Caferağa Mah. Bahariye Caddesi No:14 Kadıköy İstanbul', resolved(place()));
    expect(v).toMatchObject({ status: 'ok', notes: [], kind: 'Kapı numarası' });
    expect(v.standard?.text).toContain('Bahariye Caddesi No:14');
    expect(v.statusText).toBe('Adres tutarlı');
  });

  it('finds a district that does not fit and offers the corrected address', () => {
    const v = check('Caferağa Mah. Bahariye Caddesi No:14 Üsküdar İstanbul', resolved(place({ confidence: 0.88 })));
    expect(v.status).toBe('conflict');
    expect(v.notes[0]).toMatchObject({ code: 'district_mismatch', severity: 'error', field: 'district', fix: { value: 'Kadıköy' } });
    expect(v.notes[0]?.fix?.address).toContain('Kadıköy/İstanbul');
    expect(check('Bahariye Caddesi No:14 İstanbul', resolved(place({ notes: ['district_mismatch'] }))).notes[0]?.code).toBe('district_mismatch');
  });

  it('finds a street that is not in the written neighbourhood only when the match is weak', () => {
    const text = 'Moda Mah. Bahariye Caddesi No:14 Kadıköy İstanbul';
    expect(codes(check(text, resolved(place({ confidence: 0.78 }))))).toEqual(['street_not_in_neighbourhood']);
    expect(codes(check(text, resolved(place({ confidence: 0.97 }))))).toEqual([]);
    expect(check(text, resolved(place({ confidence: 0.78 }))).notes[0]?.fix?.value).toBe('Caferağa');
  });

  it('asks for the number when only the street was found, and flags a number that is not on the street', () => {
    expect(check('Caferağa Mah. Bahariye Caddesi Kadıköy', resolved(place({ precision: 'street', components: { street: 'Bahariye Caddesi', neighbourhood: 'Caferağa', district: 'Kadıköy' } }))).status).toBe('incomplete');
    const far = check('Caferağa Mah. Bahariye Caddesi No:9999 Kadıköy', resolved(place({ precision: 'street' })));
    expect(far.status).toBe('conflict');
    expect(codes(far)).toEqual(['number_not_on_street']);
  });

  it('tells a missing neighbourhood from an ambiguous street, with the choices', () => {
    const hood = (name: string): Place => place({ id: name, confidence: 0.8, components: { street: 'Bahariye Caddesi', neighbourhood: name, district: 'Kadıköy' } });
    const inOne = check('Bahariye Caddesi 14 Kadıköy', { status: 'ambiguous', candidates: [hood('Caferağa'), hood('Moda')] });
    expect(inOne.status).toBe('incomplete');
    expect(inOne.notes[0]).toMatchObject({ code: 'missing_neighbourhood', fix: { options: ['Caferağa', 'Moda'] } });
    const area = (district: string): Place => place({ id: district, confidence: 0.8, components: { street: 'Atatürk Caddesi', district } });
    const many = check('Atatürk Caddesi 5', { status: 'ambiguous', candidates: [area('Kadıköy'), area('Üsküdar')] });
    expect(many.notes[0]).toMatchObject({ code: 'ambiguous_street', fix: { options: ['Kadıköy', 'Üsküdar'] } });
    expect(codes(check('Atatürk Caddesi 5 Kadıköy', { status: 'ambiguous', candidates: [area('Kadıköy'), area('Kadıköy')] }))).toEqual([]);
    const stillAmbiguous = check('Atatürk Caddesi Kadıköy', { status: 'ambiguous', candidates: [area('Kadıköy'), area('Üsküdar')] });
    expect(stillAmbiguous.notes[0]?.code).toBe('ambiguous_street');
  });

  it('passes on the unit and landmark notes of the place and notes a guessed side', () => {
    const unit = { block: null, entrance: null, floor: null, door: null, levels: 3, perFloor: 2, notes: ['floor_out_of_range', 'floor_door_mismatch'] };
    const v = check('Bahariye Caddesi 14 Kat 40', resolved(place({ unit, notes: ['number_out_of_range', 'relation_not_found'] })));
    expect(codes(v).sort()).toEqual(['floor_door_mismatch', 'floor_out_of_range', 'number_out_of_range', 'relation_not_found']);
    expect(v.status).toBe('conflict');
    const guessed = check('Bahariye Caddesi 14 Kadıköy', resolved(place({ precision: 'interpolated', approximate: true })));
    expect(guessed).toMatchObject({ status: 'ok', notes: [{ code: 'parity_side_unknown', severity: 'info' }] });
    expect(codes(check('Bahariye Caddesi 14', resolved(place({ precision: 'interpolated', radiusM: 30 }))))).toEqual([]);
  });

  it('handles regions that are not installed and addresses that are not found, in any language', () => {
    const missing = check('Bornova İzmir', { status: 'region_missing', regions: ['35'] }, 'en');
    expect(missing).toMatchObject({ status: 'not_found', place: null, notes: [{ code: 'outside_installed_regions', fix: { options: ['35'] } }] });
    expect(missing.notes[0]?.message).toBe('The region for this address is not installed on the device.');
    const none = check('zzzz', { status: 'not_found', candidates: [] }, 'de', { street: 'Gül Sokak' });
    expect(none).toMatchObject({ status: 'not_found', notes: [], suggestions: { street: 'Gül Sokak' }, statusText: 'Adresse nicht gefunden' });
  });

  it('carries the street suggestion of the resolver and the neighbourhood and district suggestions', () => {
    const v = check('Gul Sk 3 Kadıköy', { ...resolved(place()), suggestion: place({ components: { street: 'Gül Sokak' } }) } as ResolveResult, 'tr', { district: 'Kadıköy', neighbourhood: 'Moda' });
    expect(v.suggestions).toEqual({ street: 'Gül Sokak', district: 'Kadıköy', neighbourhood: 'Moda' });
  });
});
