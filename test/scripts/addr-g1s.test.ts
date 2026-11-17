import { acceptable } from '../../scripts/addr-g1s';
import { flipKind } from '../../scripts/addr-nominatim-check';
import type { Door } from '../../scripts/addr-sets';

const door = (over: Partial<Door> = {}): Door => ({ id: '34:a:1', plate: '34', source: 'osm', lng: 29, lat: 41, province: 'İstanbul', district: 'Kadıköy', hood: 'Suadiye', street: 'Hazan Sokak', kind: 'sokak', number: '12', num: 12, ...over });

describe('acceptable', () => {
  it('keeps texts that carry the street and the exact door number', () => {
    expect(acceptable('Suadiye Mah. Hazan Sk. No:12 Kadıköy', door())).toBe(true);
    expect(acceptable('hazan sk 12 suadiye', door())).toBe(true);
  });

  it('rejects a wrong number, a missing street and personal data', () => {
    expect(acceptable('Suadiye Mah. Hazan Sk. No:21 Kadıköy', door())).toBe(false);
    expect(acceptable('Suadiye Mah. Lale Sk. No:12 Kadıköy', door())).toBe(false);
    expect(acceptable('Hazan Sk. No:12 tel 05321234567', door())).toBe(false);
    expect(acceptable('sk 12', door())).toBe(false);
  });

  it('matches suffixed numbers exactly', () => {
    expect(acceptable('Hazan Sk. No:12/A Kadıköy', door({ number: '12/A' }))).toBe(true);
    expect(acceptable('Hazan Sk. No:12 Kadıköy', door({ number: '12/A' }))).toBe(false);
  });
});

describe('flipKind', () => {
  it('swaps short and long street kinds in both directions', () => {
    expect(flipKind('Hazan Sokak')).toBe('Hazan Sokağı');
    expect(flipKind('Hazan Sokağı')).toBe('Hazan Sokak');
    expect(flipKind('Atatürk Caddesi')).toBe('Atatürk Cadde');
    expect(flipKind('Çamlık Yolu')).toBe('Çamlık Yolu');
  });
});
