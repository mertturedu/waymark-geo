import { doorNumber, readAddress, structuredPart, streetDisplay } from '../../pipeline/build/directory-read';

describe('structuredPart', () => {
  it('drops a business name in front of the street part', () => {
    expect(structuredPart('Tuğba Kuruyemiş, Gazi Mustafa Kemal Bulvarı 94A')).toBe('Gazi Mustafa Kemal Bulvarı 94A');
    expect(structuredPart('Adalet, güllü bahcesi, 10126 Sk. A/A sitesi A Blok, 20100 Merkezefendi')).toBe('10126 Sk. A/A sitesi A Blok');
  });
  it('keeps the whole text when nothing looks structured', () => {
    expect(structuredPart('Ellez deresi, Denizli')).toBe('Ellez deresi, Denizli');
  });
  it('keeps number only parts such as postcodes', () => {
    expect(structuredPart('Sırakapılar Mahallesi, 20100, 1581. Sk. No:4')).toBe('Sırakapılar Mahallesi, 20100, 1581. Sk. No:4');
  });
});

describe('doorNumber', () => {
  it.each([
    ['94A', '94A'],
    ['2/8', '2'],
    ['2/A', '2/A'],
    ['94a', '94A'],
    ['110AA', '110AA'],
    [' 12 ', '12'],
    ['0', null],
    ['12345', null],
    ['abc', null],
    [null, null],
  ])('%s -> %s', (given, expected) => {
    expect(doorNumber(given as string | null)).toBe(expected);
  });
});

describe('readAddress', () => {
  it('reads street and number behind a business name', () => {
    expect(readAddress('Tuğba Kuruyemiş, Gazi Mustafa Kemal Bulvarı 94A')).toEqual({ street: 'Gazi Mustafa Kemal Bulvarı', number: '94A', hood: null });
  });
  it('reads hood, numbered street and the building part of a door', () => {
    expect(readAddress('Yunusemre Mah. 6406 Sk. No:2/8 Pamukkale/DENİZLİ')).toEqual({ street: '6406 Sokak', number: '2', hood: 'yunusemre' });
  });
  it('reads a number with two letters after "No"', () => {
    expect(readAddress('Şemikler Mah. Cinkaya Bulvarı No: 110AA')).toMatchObject({ street: 'Cinkaya Bulvarı', number: '110AA', hood: 'semikler' });
  });
  it('keeps diacritics and title cases shouted names', () => {
    expect(readAddress('SÜLEYMAN DEMİREL CD. NO: 48').street).toBe('Süleyman Demirel Caddesi');
  });
  it('returns the street without a number', () => {
    expect(readAddress('3154. Sokak')).toEqual({ street: '3154 Sokak', number: null, hood: null });
  });
  it.each(['Kınıklı Semt Polikliniği', 'Ellez deresi', '', '   '])('finds no street in %j', (text) => {
    expect(readAddress(text).street).toBeNull();
  });
  it('treats a missing address as empty', () => {
    expect(readAddress(null)).toEqual({ street: null, number: null, hood: null });
  });
});

describe('readAddress rescues a door the parser leaves behind', () => {
  it.each([
    ['Malkoçoğlu Cd. no/165b', 'Malkoçoğlu Caddesi', '165B'],
    ['Tıpatan Sk. N18/a', 'Tıpatan Sokak', '18/A'],
    ['Yigitturk Caddesi, 20/C', 'Yigitturk Caddesi', '20/C'],
    ['47/A Sebzeci Sokak', 'Sebzeci Sokak', '47/A'],
    ['69/A, Kemalpaşa Cd.', 'Kemalpaşa Caddesi', '69/A'],
    ['129/1a Büyükdere Caddesi', 'Büyükdere Caddesi', '129'],
  ])('%s', (text, street, number) => {
    expect(readAddress(text)).toMatchObject({ street, number });
  });
  it.each(['Atatürk Cad No:34889', 'Şifa Sok. no 34710', 'Hicret, Kürşat Sk., 34287 Arnavutköy/İstanbul', '19 Mayıs Bulvarı'])('does not take a postcode or a street number for a door in %s', (text) => {
    expect(readAddress(text).number).toBeNull();
  });
});

describe('readAddress with an underscore between words', () => {
  it('reads the underscore as a space and keeps the diacritics', () => {
    expect(readAddress('Atatürk_10 cadde no :58')).toMatchObject({ street: 'Atatürk 10 Caddesi', number: '58' });
  });
});

describe('streetDisplay', () => {
  it('falls back to the folded label when the words cannot be found in the text', () => {
    expect(streetDisplay('zzz', { key: 'gazi mustafa kemal', kind: 'bulvar' })).toBe('Gazi Mustafa Kemal Bulvarı');
  });
});
