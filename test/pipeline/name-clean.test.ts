import { cleanName } from '../../pipeline/build/name-clean';

describe('cleanName', () => {
  it('collapses spaces and trims', () => {
    expect(cleanName('  Gül   Sokak ')).toEqual({ name: 'Gül Sokak', changes: ['boşluk'] });
  });

  it('puts a name that is all capitals or all lower case into title case with Turkish letters', () => {
    expect(cleanName('IŞIK SOKAK')).toEqual({ name: 'Işık Sokak', changes: ['hepsi büyük harf'] });
    expect(cleanName('İNÖNÜ CADDESİ').name).toBe('İnönü Caddesi');
    expect(cleanName('çiçek sokak')).toEqual({ name: 'Çiçek Sokak', changes: ['hepsi küçük harf'] });
    expect(cleanName('Gül Sokak').changes).toEqual([]);
    expect(cleanName('K2').changes).toEqual([]);
  });

  it('fixes one letter of the kind word and leaves unclear ones', () => {
    expect(cleanName('Atatürk Cadesi')).toEqual({ name: 'Atatürk Caddesi', changes: ['tür yazımı: Cadesi → Caddesi'] });
    expect(cleanName('Gül Sokagı').name).toBe('Gül Sokağı');
    expect(cleanName('Gül Sokak').changes).toEqual([]);
    expect(cleanName('Gül Caddessi').name).toBe('Gül Caddesi');
    expect(cleanName('Atatürk Bulvarr').changes).toEqual([]);
    expect(cleanName('Gül Yokaşş').changes).toEqual([]);
    expect(cleanName('Gül Sk').changes).toEqual([]);
  });
});
