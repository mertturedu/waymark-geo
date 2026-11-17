import { formatLabel } from '../../src/core/address/label';

const full = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '14' };

describe('formatLabel', () => {
  it.each([
    ['tr', 'Bahariye Caddesi No:14, Moda Mah., Kadıköy/İstanbul'],
    ['en', '14 Bahariye Caddesi, Moda, Kadıköy, İstanbul'],
    ['de', 'Bahariye Caddesi 14, Moda, Kadıköy, İstanbul'],
    ['ru', 'Bahariye Caddesi, 14, Moda, Kadıköy, İstanbul'],
    ['el', 'Bahariye Caddesi 14, Moda, Kadıköy, İstanbul'],
    ['ar', 'Bahariye Caddesi 14، Moda، Kadıköy، İstanbul'],
  ] as const)('writes a full address in %s', (lang, text) => {
    expect(formatLabel(full, lang)).toBe(text);
  });

  it('leaves out what is missing without stray commas', () => {
    expect(formatLabel({ province: 'İstanbul', district: 'Kadıköy', street: 'Bahariye Caddesi' }, 'tr')).toBe('Bahariye Caddesi, Kadıköy/İstanbul');
    expect(formatLabel({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda' }, 'tr')).toBe('Moda Mah., Kadıköy/İstanbul');
    expect(formatLabel({ province: 'İstanbul' }, 'tr')).toBe('İstanbul');
    expect(formatLabel({ province: 'İstanbul', district: 'Kadıköy' }, 'en')).toBe('Kadıköy, İstanbul');
    expect(formatLabel({}, 'tr')).toBe('');
  });

  it('puts the name of a place first and adds the building, door and postcode', () => {
    expect(formatLabel({ poiName: 'Devlet Hastanesi', neighbourhood: 'Moda', district: 'Kadıköy', province: 'İstanbul' }, 'tr')).toBe('Devlet Hastanesi, Moda Mah., Kadıköy/İstanbul');
    expect(formatLabel({ ...full, building: 'A Blok', door: '3', postcode: '34710' }, 'tr')).toBe('Bahariye Caddesi No:14 A Blok D:3, Moda Mah., Kadıköy/İstanbul 34710');
  });

  it('keeps the house number of a door that has no street', () => {
    const door = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Bostancı', houseNumber: '1' };
    expect(formatLabel(door, 'tr')).toBe('Bostancı Mah. No:1, Kadıköy/İstanbul');
    expect(formatLabel({ ...door, neighbourhood: undefined }, 'tr')).toBe('No:1, Kadıköy/İstanbul');
    expect(formatLabel({ ...door, door: '3' }, 'tr')).toBe('Bostancı Mah. No:1 D:3, Kadıköy/İstanbul');
    expect(formatLabel(door, 'en')).toBe('No. 1, Bostancı, Kadıköy, İstanbul');
    expect(formatLabel(door, 'de')).toBe('Nr. 1, Bostancı, Kadıköy, İstanbul');
    expect(formatLabel(door, 'ru')).toBe('№ 1, Bostancı, Kadıköy, İstanbul');
    expect(formatLabel(door, 'el')).toBe('Αρ. 1, Bostancı, Kadıköy, İstanbul');
    expect(formatLabel(door, 'ar')).toBe('رقم 1، Bostancı، Kadıköy، İstanbul');
  });

  it('marks the flat so it does not read as part of the house number', () => {
    const flat = { ...full, door: '3' };
    expect(formatLabel(flat, 'en')).toBe('14 Bahariye Caddesi Apt 3, Moda, Kadıköy, İstanbul');
    expect(formatLabel(flat, 'de')).toBe('Bahariye Caddesi 14 Whg. 3, Moda, Kadıköy, İstanbul');
    expect(formatLabel(flat, 'ru')).toBe('Bahariye Caddesi, 14 кв. 3, Moda, Kadıköy, İstanbul');
    expect(formatLabel(flat, 'el')).toBe('Bahariye Caddesi 14 Διαμ. 3, Moda, Kadıköy, İstanbul');
    expect(formatLabel(flat, 'ar')).toBe('Bahariye Caddesi 14 شقة 3، Moda، Kadıköy، İstanbul');
  });

  it('does not start with a space when only a postcode is known', () => {
    expect(formatLabel({ postcode: '34710' }, 'tr')).toBe('34710');
    expect(formatLabel({ postcode: '34710' }, 'en')).toBe('34710');
  });

  it('uses the Turkish form for a language it does not know', () => {
    expect(formatLabel(full, 'fr')).toBe(formatLabel(full, 'tr'));
  });
});
