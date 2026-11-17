import { stripPhones } from '../../src/core/text/noise';
import { tokenize } from '../../src/core/text/tokenize';
import { parseAddress } from '../../src/core/text/parse';

const parsed = (text: string) => parseAddress(text);

describe('phones are dropped before reading', () => {
  it('removes mobile, +90 and landline numbers and keeps house numbers', () => {
    expect(stripPhones('Gül Sk. No 12 0532 123 45 67').dropped).toEqual(['0532 123 45 67']);
    expect(stripPhones('+90 532 123 45 67 Gül Sk. 12').dropped).toEqual(['+90 532 123 45 67']);
    expect(stripPhones('Gül Sk. 12 0 (216) 345 67 89').dropped).toHaveLength(1);
    expect(stripPhones('Gül Sk. No 12 Daire 5 Kadıköy').dropped).toEqual([]);
    expect(stripPhones('1203/1 Sokak No: 5').dropped).toEqual([]);
  });

  it('does not read the phone as a street or house number', () => {
    const result = parsed('0546 808 17 12 Avşar Sokak No 32 Keçiören');
    expect(result).toMatchObject({ street: { key: 'avsar' }, houseNumber: '32', dropped: ['0546 808 17 12'], leftover: [] });
  });
});

describe('numbers written in the usual loose ways', () => {
  it('reads N: as the house number marker', () => {
    expect(parsed('Mesir Mah. 5700. Sok. N:11 Yunus Emre')).toMatchObject({ houseNumber: '11', street: { number: 5700 }, leftover: [] });
  });

  it('joins a letter written after the number', () => {
    expect(parsed('Natoyolu Caddesi 231 A Mamak').houseNumber).toBe('231a');
    expect(parsed('Seher Sk 10 C Kocasinan').houseNumber).toBe('10c');
    expect(parsed('Karanfil Sk. No 37 A Blok Kadıköy')).toMatchObject({ houseNumber: '37', block: 'a' });
    expect(parsed('Gül Sk. No 5 D 3 Kadıköy')).toMatchObject({ houseNumber: '5', door: '3' });
  });

  it('keeps two letters after the number', () => {
    expect(parsed('Velioğlu Sok 72BC Bağcılar').houseNumber).toBe('72bc');
  });

  it('takes the number written after the street out of the neighbourhood name', () => {
    expect(parsed('Nihan Sk. 28 Ayvalı mh Ankara')).toMatchObject({ houseNumber: '28', neighbourhood: 'ayvali', street: { key: 'nihan' } });
    expect(parsed('Kırım Caddesi 24 Büyükkayacık MH. Selçuklu/Konya')).toMatchObject({ houseNumber: '24', neighbourhood: 'buyukkayacik' });
  });

  it('splits a space around the slash on one side only', () => {
    expect(tokenize('No 51 /19').map((t) => t.t)).toEqual(['no', '51/19']);
    expect(tokenize('No 51/ 19').map((t) => t.t)).toEqual(['no', '51/19']);
  });
});

describe('words written together', () => {
  it('splits a lower to upper case join', () => {
    expect(parsed('ZübeydeHanım Caddesi 12 Osmangazi').street?.key).toBe(parsed('Zübeyde Hanım Caddesi 12 Osmangazi').street?.key);
    expect(parsed('Moda Mah. EskibaglarCd. No 59 Etimesgut').street?.key).toBe('eskibaglar');
  });
});

describe('notes and names around the street', () => {
  it('prefers the name just before the house number over a trailing note', () => {
    expect(parsed('Göztepe mahallesi, Tütüncü Mehmet Efendi, No:107, Kadıköy arayınız lütfen').street?.text).toBe('tutuncu mehmet efendi');
  });

  it('reads the street of a building list entry without taking the building name', () => {
    expect(parsed('Kartal/İstanbul Orhantepe Mah. Huzur İş Merkezi Palmiye Sokağı No 12')).toMatchObject({ street: { key: 'palmiye' }, houseNumber: '12' });
  });

  it('reads an asphalt road as a street', () => {
    expect(parsed('Barbaros Mah. Eski Edirne Asfaltı 336/A Fatih').street?.key).toBe('eski edirne');
  });

  it('reads a numbered street without the street word', () => {
    expect(parsed('İstanbul Göztepe mh Yıldız Sitesi 2346. No.23')).toMatchObject({ street: { key: '2346' }, houseNumber: '23' });
  });
});

describe('alternatives', () => {
  it('offers the outer number and the door for a numeric compound', () => {
    const result = parsed('Gül Sk. No: 51/19 Kadıköy');
    expect(result.houseNumber).toBe('51/19');
    expect(result.alternatives.map((a) => [a.houseNumber, a.door])).toContainEqual(['51', '19']);
  });

  it('offers both readings of a second number after the house number', () => {
    const result = parsed('Bağcı Caddesi No 34 7 Keçiören');
    expect(result.alternatives.map((a) => [a.houseNumber, a.door])).toEqual(expect.arrayContaining([['34', '7'], ['34/7', null]]));
  });

  it('offers street and neighbourhood splits when the street has no kind word', () => {
    const result = parsed('Mimar Sinan Merkez Mah 8 Pursaklar');
    const splits = result.alternatives.map((a) => [a.street?.text, a.neighbourhood]);
    expect(splits).toEqual(expect.arrayContaining([['mimar sinan', 'merkez'], ['mimar', 'sinan merkez']]));
  });

  it('has no alternatives for a clean address', () => {
    expect(parsed('Moda Mah. Bahariye Cd. 14 Kadıköy').alternatives).toEqual([]);
  });
});

describe('delivery notes are dropped', () => {
  it('drops known note phrases and keeps them in dropped', () => {
    const result = parsed('Bostancı Mah. Tariki Has Sk. No 12 Kadıköy zile basmayın arayınız lütfen');
    expect(result.dropped).toEqual(['zile basmayin arayiniz lutfen']);
    expect(result).toMatchObject({ street: { key: 'tariki has' }, houseNumber: '12', leftover: [] });
    expect(parsed('Gül Sk. 5 Kadıköy teslimat saat 18den sonra').dropped).toEqual(['teslimat saat 18den sonra']);
    expect(parsed('Gül Sk. 5 Kadıköy kapıda ödeme').dropped).toEqual(['kapida odeme']);
  });

  it('does not take a district named Zile for a note, nor drop address words', () => {
    expect(parsed('Zile Tokat Atatürk Cd. 5')).toMatchObject({ district: { name: 'Zile' }, dropped: [] });
    expect(parsed('Kargo Sokak 5 Kadıköy').dropped).toEqual([]);
    expect(parsed('Gül Sk. 5 Kadıköy kargo').dropped).toEqual(['kargo']);
  });
});

describe('repeated street markers', () => {
  it('reads an abbreviation followed by a long form once', () => {
    expect(parsed('Moda Mah. Demokrasi Cad. Cadde No 78 Kadıköy')).toMatchObject({ street: { key: 'demokrasi' }, houseNumber: '78' });
    expect(parsed('Etlik Mah. Hayrat Sk. Sok. N:27 Keçiören').street?.key).toBe('hayrat');
  });
});

describe('named numbers stay in the neighbourhood', () => {
  it('keeps the number of month and anniversary names', () => {
    expect(parsed('Şemsettin Günaltay Caddesi 19 Mayıs Mh. N:154 Şile')).toMatchObject({ neighbourhood: '19 mayis', houseNumber: '154' });
    expect(parsed('Ankara Yolu Cd. 152 Evler Mah. 256 Yıldırım').neighbourhood).toBe('152 evler');
  });
});

describe('unit expressions in the common spoken forms', () => {
  const base = 'Atatürk Mah. Gül Sok. No:12 Çankaya';
  const unit = (tail: string) => {
    const p = parsed(`${base} ${tail}`);
    return { no: p.houseNumber, floor: p.floor, door: p.door, block: p.block };
  };

  it('reads "N nolu daire" and "N numaralı daire N. katta" as the door', () => {
    expect(unit('3. kat 7 nolu daire')).toEqual({ no: '12', floor: '3', door: '7', block: null });
    expect(unit('7 numaralı daire 3. katta')).toEqual({ no: '12', floor: '3', door: '7', block: null });
    expect(unit('B Blok 5. Kat 12 Nolu Daire')).toEqual({ no: '12', floor: '5', door: '12', block: 'b' });
  });

  it('reads "N. Kat No:D" as the door once the house number is known', () => {
    expect(unit('9. Kat No:39')).toEqual({ no: '12', floor: '9', door: '39', block: null });
  });

  it('splits kat:3/daire:7 and keeps house numbers like 15/d and 11-1 intact', () => {
    expect(unit('kat:3/daire:7')).toEqual({ no: '12', floor: '3', door: '7', block: null });
    expect(parsed('Gül Sk. No:11-1 kat:1 Çankaya')).toMatchObject({ houseNumber: '11-1', floor: '1' });
    expect(parsed('Gül Sk. kapı no: 15/d 1. kat d 19 Çankaya')).toMatchObject({ floor: '1', door: '19' });
  });

  it('reads negative floors as the basement', () => {
    expect(unit('Kat: -1 Daire 2')).toEqual({ no: '12', floor: 'bodrum', door: '2', block: null });
    expect(unit('-1. kat daire 4').floor).toBe('bodrum');
  });
});
