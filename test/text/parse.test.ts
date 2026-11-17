import { MAX_INPUT, nameKey } from '../../src/core/text/fold';
import { parseAddress } from '../../src/core/text/parse';

const parsed = (text: string) => parseAddress(text);

describe('Turkish addresses', () => {
  it('reads the whole sentence from the plan example', () => {
    expect(parsed('balikesir karesi pasaalani mah 1. sk no 12 d 3')).toMatchObject({
      language: 'tr',
      province: { id: '10', name: 'Balıkesir', ambiguous: false },
      district: { id: '10/karesi', name: 'Karesi' },
      neighbourhood: 'pasaalani',
      street: { key: '1', kind: 'sokak', number: 1 },
      houseNumber: '12',
      door: '3',
      leftover: [],
    });
  });

  it('does not take a neighbourhood called like the province for the province (Iğdır)', () => {
    expect(parsed('Iğdır Merkez Iğdır Mah. Atatürk Cd. 5')).toMatchObject({
      province: { id: '76' },
      district: { name: 'Merkez', plate: '76' },
      neighbourhood: 'igdir',
      street: { key: 'ataturk', kind: 'cadde' },
      houseNumber: '5',
    });
  });

  it('reads comma separated hierarchies and finds the province from the district', () => {
    expect(parsed('Kadıköy, Moda Mah., Bahariye Cd. 14')).toMatchObject({
      province: { id: '34' },
      district: { id: '34/kadikoy', ambiguous: false },
      neighbourhood: 'moda',
      street: { key: 'bahariye', kind: 'cadde' },
      houseNumber: '14',
    });
  });

  it('matches names with and without a space and keeps honorific prefixes in the key', () => {
    expect(parsed('yeni pınar sokak').street).toMatchObject({ key: 'yeni pinar', compact: 'yenipinar' });
    expect(parsed('yenipınar sk').street).toMatchObject({ key: 'yenipinar', compact: 'yenipinar' });
    expect(parsed('şehit mehmet sokağı no elli beş')).toMatchObject({ street: { key: 'sehit mehmet', compact: 'mehmet' }, houseNumber: '55' });
  });

  it('keeps a numbered street apart from the house number in both word orders', () => {
    const a = parsed('5 no 1707 sk');
    const b = parsed('1707 sokak no 5');
    for (const result of [a, b]) expect(result).toMatchObject({ street: { key: '1707', number: 1707, kind: 'sokak' }, houseNumber: '5' });
  });

  it('reads door, floor and block markers', () => {
    expect(parsed('Atatürk Cd. No:12/3 D:4 K:2 Blok B')).toMatchObject({
      street: { key: 'ataturk', kind: 'cadde' },
      houseNumber: '12/3',
      door: '4',
      floor: '2',
      block: 'b',
    });
    expect(parsed('Gül Sk. no 7 3. kat daire 9')).toMatchObject({ houseNumber: '7', floor: '3', door: '9' });
    expect(parsed('Gül Sk. no5 d3 k2')).toMatchObject({ houseNumber: '5', door: '3', floor: '2' });
  });

  it('reads building and site names', () => {
    expect(parsed('Gül Apartmanı Atatürk Cd. 5')).toMatchObject({ building: 'gul', street: { key: 'ataturk' }, houseNumber: '5' });
    expect(parsed('Yeşil Vadi Sitesi A Blok')).toMatchObject({ building: 'yesil vadi', block: 'a' });
  });

  it('takes a trailing number as the house number when there is no number word', () => {
    expect(parsed('Bahariye Caddesi 14')).toMatchObject({ street: { key: 'bahariye' }, houseNumber: '14' });
    expect(parsed('Bahariye Caddesi 14/A')).toMatchObject({ houseNumber: '14/a' });
    expect(parsed('Bahariye Caddesi 12-14')).toMatchObject({ houseNumber: '12-14' });
  });

  it('reads a postcode apart from the house number', () => {
    expect(parsed('34710 Kadıköy')).toMatchObject({ postcode: '34710', district: { id: '34/kadikoy' }, houseNumber: null });
    expect(parsed('Bahariye Cd. no 5 34710')).toMatchObject({ postcode: '34710', houseNumber: '5' });
  });

  it('puts a separate unmarked group between district and street into the neighbourhood', () => {
    expect(parsed('Kadıköy, Moda, Bahariye Cd 14')).toMatchObject({ district: { id: '34/kadikoy' }, neighbourhood: 'moda', street: { key: 'bahariye' }, houseNumber: '14' });
  });

  it('cannot split unmarked words in one group, so they all go to the street', () => {
    expect(parsed('Kadıköy Moda Bahariye Cd 14')).toMatchObject({ district: { id: '34/kadikoy' }, neighbourhood: null, street: { key: 'moda bahariye' }, houseNumber: '14' });
  });

  it('reads a place name', () => {
    expect(parsed('Acıbadem Hastanesi Kadıköy')).toMatchObject({ poiName: 'acibadem hastanesi', district: { id: '34/kadikoy' } });
  });
});

describe('lessons from generated sentences', () => {
  it('does not take a five digit street number for a postcode', () => {
    expect(parsed('Bandırma Kayacık Mah. 14049 Sokağı Numara 15')).toMatchObject({ street: { key: '14049', kind: 'sokak' }, houseNumber: '15', postcode: null });
    expect(parsed('merkezefendi 10071. sk. no: 17')).toMatchObject({ street: { key: '10071' }, houseNumber: '17', postcode: null });
  });

  it('keeps the number of a "nolu" street and ignores the word nolu', () => {
    expect(parsed('Kahramankazan Ankara, 7 Nolu Caddesi No 2')).toMatchObject({ street: { key: '7', kind: 'cadde' }, houseNumber: '2', leftover: [] });
  });

  it('lets a street word belong to the name when another street word follows', () => {
    expect(parsed('İzmir Yolu Cd. 307, Nilüfer')).toMatchObject({ street: { key: 'izmir yolu', kind: 'cadde' }, houseNumber: '307', district: { name: 'Nilüfer' } });
    expect(parsed('Cumhuriyet Mah. Sisecam Yolu Sokagi No 7')).toMatchObject({ neighbourhood: 'cumhuriyet', street: { key: 'sisecam yolu', kind: 'sokak' }, houseNumber: '7' });
    expect(parsed('Yeni Mahalle Mahallesi, Yüce Sokak 8/A')).toMatchObject({ neighbourhood: 'yeni mahalle', street: { key: 'yuce' }, houseNumber: '8/a' });
  });

  it('reads the number after Daire No and Kat No', () => {
    expect(parsed('Kırmızı Cd. No: 24 3. Kat Daire No: 23')).toMatchObject({ houseNumber: '24', floor: '3', door: '23' });
    expect(parsed('Gül Sk. Kapı No: 7 Kat No: 2 Daire No: 5')).toMatchObject({ houseNumber: '7', floor: '2', door: '5' });
  });

  it('keeps a trailing letter on a house number', () => {
    expect(parsed('Uzay Sokak No 19D')).toMatchObject({ houseNumber: '19d', door: null });
    expect(parsed('15 Temmuz Cad. 18D')).toMatchObject({ street: { key: '15 temmuz' }, houseNumber: '18d' });
    expect(parsed('Akkuzulu Sokak No 155-B')).toMatchObject({ houseNumber: '155-b', leftover: [] });
    expect(parsed('Kızılay Cd. 4-A')).toMatchObject({ houseNumber: '4-a' });
  });

  it('puts the words before a numbered street into the neighbourhood', () => {
    expect(parsed('kocaeli gebze sultan orhan 1104. sokak kapı no: 1')).toMatchObject({ neighbourhood: 'sultan orhan', street: { key: '1104', number: 1104 }, houseNumber: '1' });
    expect(parsed('PAŞAKENT, 17004 SOKAĞI KAPI NO: 32')).toMatchObject({ neighbourhood: 'pasakent', street: { key: '17004' }, houseNumber: '32' });
  });

  it('prefers the district that fits the province over a name that only looks like a district', () => {
    expect(parsed('Hüsamettin Çelebi, Yeşilçam Sokağı 8, Konya Selçuklu')).toMatchObject({ province: { id: '42' }, district: { name: 'Selçuklu' }, neighbourhood: 'husamettin celebi' });
    expect(parsed('Selçuk Bey Mh., 560. Sokağı Numara 9, Merkezefendi Denizli')).toMatchObject({ province: { id: '20' }, district: { name: 'Merkezefendi' }, neighbourhood: 'selcuk bey' });
  });
});

describe('more lessons from generated sentences', () => {
  it('reads K:4 as the floor and keeps the number before it as the house number', () => {
    expect(parsed('Sığacık Mah., 170. Sk. 11 K:4 Daire 14')).toMatchObject({ street: { key: '170' }, houseNumber: '11', floor: '4', door: '14' });
    expect(parsed('yasemin sokak 6 kat 8 d 12')).toMatchObject({ houseNumber: '6', floor: '8', door: '12' });
    expect(parsed('Gül Sk. no 7 3. kat')).toMatchObject({ houseNumber: '7', floor: '3' });
  });

  it('takes the letter before Blok when a door marker follows', () => {
    expect(parsed('Caddesi No: 6A K:5 B Blok D:15')).toMatchObject({ houseNumber: '6a', floor: '5', block: 'b', door: '15' });
    expect(parsed('Sevinç Sokak Numara 3/1 K:3 A Blok D:16')).toMatchObject({ block: 'a', door: '16' });
  });

  it('keeps a small number inside a street name and only treats a long or slashed one as the whole name', () => {
    expect(parsed('çandarlı mah., bimeyko 8 sokağı no: 106')).toMatchObject({ neighbourhood: 'candarli', street: { key: 'bimeyko 8' }, houseNumber: '106' });
    expect(parsed('İçmeler Mah., Umut 6 Sk. No: 9')).toMatchObject({ street: { key: 'umut 6' }, houseNumber: '9' });
    expect(parsed('Kocaeli Gebze Sultan Orhan 1104. Sokak No 1')).toMatchObject({ neighbourhood: 'sultan orhan', street: { key: '1104' } });
    expect(parsed('Seferihisar Necat Hepkon 93/3. Sok. No 9A')).toMatchObject({ neighbourhood: 'necat hepkon', street: { key: '93 3' } });
  });

  it('keeps both street words when the name itself holds one', () => {
    expect(parsed('Beykoz Espiri Çıkmazı Sokağı No 2').street).toMatchObject({ key: 'espiri cikmazi', kind: 'sokak' });
  });
});

describe('even more lessons from generated sentences', () => {
  it('keeps marker words of other languages out of names written in one language', () => {
    expect(parsed('Mehmet Akif, 29 Ziya-ul Hak Ave, Sultanbeyli')).toMatchObject({ language: 'en', neighbourhood: 'mehmet akif', street: { key: 'ziya ul hak', kind: 'cadde' }, houseNumber: '29', leftover: [] });
  });

  it('picks the district that comes last when a neighbourhood has a district name', () => {
    expect(parsed('Esenler, 12 Revzen Street floor 2, İstanbul Pendik')).toMatchObject({ province: { id: '34' }, district: { name: 'Pendik' }, neighbourhood: 'esenler', street: { key: 'revzen' }, houseNumber: '12', floor: '2' });
    expect(parsed('Güzelyurt, 44 5705. St, Yunusemre')).toMatchObject({ district: { name: 'Yunusemre' }, neighbourhood: 'guzelyurt', street: { key: '5705' }, houseNumber: '44' });
  });

  it('picks the province that fits the district', () => {
    expect(parsed('Sakarya, Şerbetli St 24, Selçuklu/Konya')).toMatchObject({ province: { id: '42' }, district: { name: 'Selçuklu' }, neighbourhood: 'sakarya' });
  });

  it('reads a house number with a slash or letter before the street', () => {
    expect(parsed('101/a Gazipaşa Avenue floor 4 block b apartment 4')).toMatchObject({ language: 'en', street: { key: 'gazipasa' }, houseNumber: '101/a', floor: '4', block: 'b', door: '4' });
    expect(parsed('14A SAFAK STREET, TEKIRDAG KAPAKLI')).toMatchObject({ street: { key: 'safak' }, houseNumber: '14a' });
  });

  it('allows a long street name', () => {
    expect(parsed('43 KORUMA SIRKETLER GRUBU IDARI BINA ROAD APARTMENT 8')).toMatchObject({ street: { key: 'koruma sirketler grubu idari bina', kind: 'yol' }, houseNumber: '43', door: '8' });
  });

  it('keeps a short dotted number inside a name when a word comes first', () => {
    expect(parsed('Merkez, Ahmet Turangazi Neighbourhood, OSB 5. Avenue 6')).toMatchObject({ street: { key: 'osb 5', kind: 'cadde' }, houseNumber: '6' });
  });
});

describe('Russian lessons', () => {
  it('does not take a five digit street number after the street word for a postcode', () => {
    expect(parsed('мкр. ихсанийе, ул. 13090 6, балыкесир Бандырма')).toMatchObject({ street: { key: '13090' }, houseNumber: '6', postcode: null });
  });

  it('reads a hood name that ends in a dotted number and a word', () => {
    expect(parsed('истанбул, мкр. бахчешехир 2. кысым, ул. карделен д. 1F')).toMatchObject({ neighbourhood: 'bahcesehir 2 kisim', street: { key: 'kardelen' }, houseNumber: '1f', leftover: [] });
  });
});

describe('Russian number lessons', () => {
  it('stops a numbered street at the second number', () => {
    expect(parsed('памуккале/денизли, ул. 112. 4 кв. 8')).toMatchObject({ street: { key: '112' }, houseNumber: '4', door: '8' });
    expect(parsed('улица 8 Марта 5')).toMatchObject({ street: { key: '8 marta' }, houseNumber: '5' });
  });
});

describe('Greek lessons', () => {
  it('keeps a number inside the street name when another number follows', () => {
    expect(parsed('Οδός OSB 8. 5')).toMatchObject({ street: { key: 'osb 8' }, houseNumber: '5' });
    expect(parsed('οδός ντενιζκοϊ 3 9')).toMatchObject({ street: { key: 'denizkoy 3' }, houseNumber: '9' });
    expect(parsed('улица Умут 6 д. 5')).toMatchObject({ street: { key: 'umut 6' }, houseNumber: '5' });
  });
});

describe('place words inside names', () => {
  it('does not take a neighbourhood called Camikebir or Çarşıbaşı for a place when a street follows', () => {
    expect(parsed('Camikebir, Atatürk Cad. No: 20/E, Konya Kulu')).toMatchObject({ neighbourhood: 'camikebir', poiName: null, street: { key: 'ataturk' }, houseNumber: '20/e' });
    expect(parsed('Çarşıbaşı, Garipler Sokak No 12, Sivas Merkez')).toMatchObject({ neighbourhood: 'carsibasi', poiName: null, district: { name: 'Merkez' }, province: { id: '58' } });
  });
});

describe('German compound street names', () => {
  it('splits a street word written together with the name', () => {
    expect(parsed('Hauptstraße 12')).toMatchObject({ street: { key: 'haupt', kind: 'sokak' }, houseNumber: '12' });
    expect(parsed('Gartenweg Nummer 4')).toMatchObject({ street: { key: 'garten', kind: 'yol' }, houseNumber: '4' });
    expect(parsed('Marktplatz 3')).toMatchObject({ street: { key: 'markt', kind: 'meydan' }, houseNumber: '3' });
    expect(parsed('Kirchgasse 7, Kadıköy')).toMatchObject({ street: { key: 'kirch' }, houseNumber: '7', district: { name: 'Kadıköy' } });
  });

  it('leaves short or unrelated words alone', () => {
    expect(parsed('Karaweg 1').street).toMatchObject({ key: 'kara', kind: 'yol' });
    expect(parsed('Kadıköy Sackgasse 3')).toMatchObject({ street: { key: 'kadikoy', kind: 'cikmaz' }, houseNumber: '3' });
  });
});

describe('review: blocks named D', () => {
  it('reads D after Blok as the block, not as the door marker', () => {
    expect(parsed('Gül Sokak 5 Blok D')).toMatchObject({ houseNumber: '5', block: 'd', door: null });
    expect(parsed('Mustafa Akyol Sokağı 14/5 Blok D Daire 15')).toMatchObject({ houseNumber: '14/5', block: 'd', door: '15' });
    expect(parsed('Caddesi No: 6A K:5 B Blok D:15')).toMatchObject({ block: 'b', door: '15' });
  });
});

describe('review round: names that look like districts', () => {
  it('keeps common district names inside longer names when no province backs them', () => {
    expect(parsed('Yıldırım Beyazıt Mah. Atatürk Cad. No 5')).toMatchObject({ district: null, neighbourhood: 'yildirim beyazit', street: { key: 'ataturk' } });
    expect(parsed('Fatih Sultan Mehmet Mah. Kayışdağı Cad. No:24 İstanbul')).toMatchObject({ province: { id: '34' }, district: null, neighbourhood: 'fatih sultan mehmet' });
    expect(parsed('Fatih Sultan Mehmet Cad. No 12')).toMatchObject({ district: null, street: { key: 'fatih sultan mehmet' } });
  });

  it('still reads such a district when the province or a comma shows it is one', () => {
    expect(parsed('İstanbul Fatih Sultan Ahmet Mah. Cad. 3')).toMatchObject({ province: { id: '34' }, district: { name: 'Fatih' } });
    expect(parsed('Fatih, Atatürk Cd. 5')).toMatchObject({ district: { name: 'Fatih' } });
  });

  it('does not take a name before kat, apt or site for a district', () => {
    expect(parsed('Gül Sk. No 5 Bodrum Kat Daire 1')).toMatchObject({ district: null, floor: 'bodrum', door: '1' });
    expect(parsed('Akdeniz Apt. No 5 Kat 2')).toMatchObject({ district: null, building: 'akdeniz', floor: '2' });
    expect(parsed('Atatürk Caddesi On Dokuz Mayıs Sitesi')).toMatchObject({ district: null, building: 'on dokuz mayis', houseNumber: null });
    expect(parsed('Atatürk Caddesi Beş Yıldız Sitesi A Blok')).toMatchObject({ houseNumber: null, building: 'bes yildiz', block: 'a' });
  });
});

describe('review round: ilçe words', () => {
  it('does not file the Russian and German words for district as neighbourhood words', () => {
    expect(parsed('Стамбул, район Кадыкёй, улица Бахарие, д. 14')).toMatchObject({ province: { id: '34' }, district: { name: 'Kadıköy' }, neighbourhood: null });
    expect(parsed('Bahariye Straße 14, Kadıköy Bezirk, Istanbul')).toMatchObject({ district: { name: 'Kadıköy' }, neighbourhood: null });
    expect(parsed('мкр. Мода, улица Бахарие 14')).toMatchObject({ neighbourhood: 'moda' });
  });
});

describe('review round: other fixes', () => {
  it('keeps a postcode after a street word out of the house number', () => {
    expect(parsed('Atatürk Blv. 06100 Çankaya')).toMatchObject({ postcode: '06100', houseNumber: null });
    expect(parsed('Kızılay Mah. 06420 Çankaya/Ankara')).toMatchObject({ postcode: '06420', houseNumber: null });
  });

  it('splits groups at the Arabic comma and the full width comma', () => {
    expect(parsed('Kadıköy، Moda، Bahariye Cd 14')).toMatchObject({ neighbourhood: 'moda', street: { key: 'bahariye' }, houseNumber: '14' });
    expect(parsed('Kadıköy， Moda， Bahariye Cd 14')).toMatchObject({ neighbourhood: 'moda' });
  });

  it('does not take Çamlıca or a short transliterated root for a place name', () => {
    expect(parsed('Çamlıca 12 Üsküdar').poiName).toBeNull();
    expect(parsed('Meriç Sokak 3').poiName).toBeNull();
    expect(parsed('Sudak Sokak 3').poiName).toBeNull();
  });

  it('gives decomposed Cyrillic and Greek the same key as the composed letters', () => {
    const decomposed = (text: string) => text.split('й').join('и\u0306').split('ё').join('е\u0308').split('ϊ').join('ι\u0308');
    expect(nameKey(decomposed('Кадыкёй'))).toBe('kadikoy');
    expect(nameKey(decomposed('Кадыкёй'))).toBe(nameKey('Кадыкёй'));
    expect(nameKey(decomposed('Χάταϊ'))).toBe(nameKey('Χάταϊ'));
    expect(nameKey('Χάταϊ')).toBe('hatay');
  });
});

describe('addresses without street or neighbourhood words', () => {
  it('takes the last word group before a number as the street', () => {
    expect(parsed('Atatürk 12')).toMatchObject({ street: { key: 'ataturk', kind: null }, houseNumber: '12', neighbourhood: null });
  });

  it('takes an earlier group as the neighbourhood', () => {
    expect(parsed('Moda, Bahariye 14')).toMatchObject({ neighbourhood: 'moda', street: { key: 'bahariye', kind: null }, houseNumber: '14' });
  });

  it('takes a lone group after a district as the neighbourhood', () => {
    expect(parsed('Kadıköy Moda')).toMatchObject({ district: { id: '34/kadikoy' }, neighbourhood: 'moda', street: null });
  });

  it('splits markers glued to numbers on either side', () => {
    expect(parsed('Gül Sk. no5 3kat 9daire')).toMatchObject({ houseNumber: '5', floor: '3', door: '9' });
    expect(parsed('Gül Sk. 2blok')).toMatchObject({ block: '2' });
  });
});

describe('names that look like places', () => {
  it('keeps a district or province name that sits inside a street or neighbourhood name', () => {
    expect(parsed('Üsküdar Cd. 4')).toMatchObject({ district: null, province: null, street: { key: 'uskudar' } });
    expect(parsed('Ankara Yolu 3')).toMatchObject({ province: null, street: { key: 'ankara', kind: 'yol' } });
    expect(parsed('Yıldırım Mah. 5. Sk.')).toMatchObject({ neighbourhood: 'yildirim', district: null, street: { number: 5 } });
    expect(parsed('Merkez Mah. Merkez Sk. 5')).toMatchObject({ neighbourhood: 'merkez', street: { key: 'merkez' }, district: null, houseNumber: '5' });
  });

  it('leaves a district name used in several provinces open', () => {
    const result = parsed('Merkez');
    expect(result.district).toMatchObject({ name: 'Merkez', ambiguous: true });
    expect(result.province).toBeNull();
  });

  it('narrows a shared district name with the province', () => {
    expect(parsed('Bolu Merkez')).toMatchObject({ province: { id: '14' }, district: { plate: '14', ambiguous: false } });
  });

  it('does not keep a district that the province does not have', () => {
    expect(parsed('Ankara Merkez')).toMatchObject({ province: { id: '06' }, district: null, leftover: ['merkez'] });
  });

  it('drops the word il or ilçe after a place', () => {
    expect(parsed('İstanbul ili Kadıköy ilçesi')).toMatchObject({ province: { id: '34' }, district: { id: '34/kadikoy' }, leftover: [] });
  });
});

describe('other languages', () => {
  it('reads Russian with a prefix street word', () => {
    expect(parsed('Стамбул Кадыкёй ул. Ататюрк 5')).toMatchObject({
      language: 'ru',
      province: { id: '34' },
      district: { id: '34/kadikoy' },
      street: { key: 'ataturk', kind: 'sokak' },
      houseNumber: '5',
    });
    expect(parsed('улица Ататюрк, дом 5, квартира 3')).toMatchObject({ street: { key: 'ataturk' }, houseNumber: '5', door: '3' });
  });

  it('reads Greek', () => {
    expect(parsed('Οδός Ατατούρκ 5, Κωνσταντινούπολη')).toMatchObject({ language: 'el', street: { key: 'ataturk', kind: 'sokak' }, houseNumber: '5', province: { id: '34' } });
  });

  it('reads German', () => {
    expect(parsed('Atatürk Straße 5, Kadıköy, Istanbul')).toMatchObject({ language: 'de', street: { key: 'ataturk', kind: 'sokak' }, houseNumber: '5', district: { id: '34/kadikoy' }, province: { id: '34' } });
  });

  it('reads English with the number before the street', () => {
    expect(parsed('12 Atatürk Street, Kadıköy')).toMatchObject({ language: 'en', street: { key: 'ataturk' }, houseNumber: '12', district: { id: '34/kadikoy' } });
    expect(parsed('Atatürk Street no 5 floor 3 apartment 7')).toMatchObject({ houseNumber: '5', floor: '3', door: '7' });
  });

  it('reads Arabic words and numbers and keeps the Arabic name', () => {
    expect(parsed('شارع أتاتورك رقم ٥ طابق ٣')).toMatchObject({ language: 'ar', street: { key: 'اتاتورك', kind: 'sokak' }, houseNumber: '5', floor: '3' });
  });
});

describe('odd input', () => {
  it.each(['', ' ', '.', '!!!', ',,,;;;', '\n\n', '😀', '‏‎'])('gives an empty result for %j', (text) => {
    expect(parsed(text)).toMatchObject({
      language: null, province: null, district: null, neighbourhood: null, street: null, houseNumber: null,
      building: null, block: null, floor: null, door: null, poiName: null, postcode: null, leftover: [],
    });
  });

  it('reads a lone number as the house number and a lone province as the province', () => {
    expect(parsed('12').houseNumber).toBe('12');
    expect(parsed('istanbul')).toMatchObject({ province: { id: '34' }, district: null, houseNumber: null });
  });

  it('keeps words it cannot place in leftover', () => {
    expect(parsed('zzzz qqqq').leftover).toEqual(['zzzz', 'qqqq']);
  });

  it('cuts long input and never fails on it', () => {
    const result = parsed('a '.repeat(600) + 'Atatürk Cd. 5');
    expect(result.input.length).toBeLessThanOrEqual(MAX_INPUT);
  });

  it('gives the same result for decomposed letters and invisible marks', () => {
    const clean = parsed('Bahariye Caddesi No 5 Kadıköy');
    expect(parsed('Bahariye Caddesi No 5 Kadi̇köy')).toEqual({ ...clean, input: expect.any(String) });
    expect(parsed('‏Bahariye​ Caddesi‎ No 5 Kadıköy')).toEqual({ ...clean, input: expect.any(String) });
  });

  it('is not confused by repeated markers', () => {
    expect(() => parsed('sk sk sk no no no d d d kat kat mah mah')).not.toThrow();
    expect(parsed('no no 5 5 5').houseNumber).toBe('5');
  });
});

describe('review follow-ups', () => {
  it('keeps a second street apart from the first and out of leftover', () => {
    expect(parsed('1. Cad. 2. Sk. No 5 Kadıköy İstanbul')).toMatchObject({ street: { key: '1', kind: 'cadde' }, secondStreet: { key: '2', kind: 'sokak', number: 2 }, houseNumber: '5', leftover: [] });
    expect(parsed('Moda Mah. Bahariye Cad. Gül Sk. No 5 Kadıköy')).toMatchObject({ neighbourhood: 'moda', street: { key: 'bahariye' }, secondStreet: { key: 'gul', kind: 'sokak' }, houseNumber: '5', leftover: [] });
    expect(parsed('Moda Mah. Bahariye Cad. No 5 Kadıköy').secondStreet).toBeNull();
  });

  it('takes the number after a second street as the house number', () => {
    expect(parsed('Bahariye Cad. Gül Sk. 7 Kadıköy')).toMatchObject({ street: { key: 'bahariye' }, secondStreet: { key: 'gul' }, houseNumber: '7' });
  });

  it('does not make a second street out of a street word that belongs to the name', () => {
    expect(parsed('Beykoz Espiri Çıkmazı Sokağı No 2').secondStreet).toBeNull();
  });

  it('keeps the flat number of İç Kapı No next to the house number of Dış Kapı No', () => {
    const expected = { street: { key: 'bahariye' }, houseNumber: '12', door: '3', leftover: [] };
    expect(parsed('Moda Mah. Bahariye Cad. İç Kapı No: 3 Dış Kapı No: 12 Kadıköy')).toMatchObject(expected);
    expect(parsed('Moda Mah. Bahariye Cad. Dış Kapı No: 12 İç Kapı No: 3 Kadıköy')).toMatchObject(expected);
    expect(parsed('Bahariye Cad. Dış Kapı: 12 İç Kapı: 3 Kadıköy')).toMatchObject(expected);
    expect(parsed('Bahariye Cad. İç Kapı No 3 Kadıköy')).toMatchObject({ door: '3', houseNumber: null });
  });

  it('still reads plain Kapı No as the house number', () => {
    expect(parsed('Bahariye Cad. Kapı No: 12 Kadıköy')).toMatchObject({ houseNumber: '12', door: null, leftover: [] });
  });

  it('joins a house number written with spaces around the slash', () => {
    expect(parsed('Moda Mah. Bahariye Cad. No: 12 / 3 Kadıköy')).toMatchObject({ houseNumber: '12/3', leftover: [] });
    expect(parsed('Bahariye Cad. No 12 / A Kadıköy').houseNumber).toBe('12a');
  });

  it('reads a block named by a letter and a digit', () => {
    expect(parsed('Moda Mah. Bahariye Cad. A1 Blok No 4 Kadıköy')).toMatchObject({ block: 'a1', houseNumber: '4', leftover: [] });
    expect(parsed('Moda Mah. Bahariye Cad. Blok B2 No 4 Kadıköy')).toMatchObject({ block: 'b2', houseNumber: '4' });
  });

  it('reads Antep, Maraş, Urfa, Afyon and İçel as the provinces they stand for', () => {
    expect(parsed('Antep Şahinbey')).toMatchObject({ province: { id: '27' }, district: { name: 'Şahinbey' }, neighbourhood: null });
    expect(parsed('Maraş').province?.id).toBe('46');
    expect(parsed('Urfa Eyyübiye').province?.id).toBe('63');
    expect(parsed('Afyon').province?.id).toBe('03');
    expect(parsed('İçel').province?.id).toBe('33');
  });
});

describe('word lists and anchors', () => {
  it.each(['il', 'ili', 'province'])('drops the word %s next to a province', (word) => {
    expect(parsed(`Bahariye Cad. 5 Kadıköy İstanbul ${word}`).leftover).toEqual([]);
    expect(parsed(`Bahariye Cad. 5 Kadıköy ${word} İstanbul`).leftover).toEqual([]);
  });

  it.each(['ilce', 'ilcesi', 'district', 'район', 'Bezirk'])('drops the word %s next to a district', (word) => {
    expect(parsed(`Bahariye Cad. 5 Kadıköy ${word}, İstanbul`).leftover).toEqual([]);
    expect(parsed(`Bahariye Cad. 5, ${word} Kadıköy, İstanbul`).leftover).toEqual([]);
  });

  it.each([['Bodrum', 'bodrum'], ['Zemin', 'zemin'], ['Çatı', 'cati']])('reads %s before Kat as the floor', (word, floor) => {
    expect(parsed(`Bahariye Cad. 5 ${word} Kat Kadıköy`)).toMatchObject({ floor, houseNumber: '5' });
  });

  it.each([['Fatih', 'fatih'], ['Yıldırım', 'yildirim'], ['Selçuk', 'selcuk'], ['Çelebi', 'celebi']])('keeps %s inside a longer name when no province backs it', (name, key) => {
    expect(parsed(`${name} Sultan Mah. Atatürk Cad. No 5`)).toMatchObject({ district: null, neighbourhood: `${key} sultan` });
  });

  it.each([['Hauptstrasse 12', 'haupt', 'sokak'], ['Marktgasse 3', 'markt', 'sokak'], ['Lindenallee 7', 'linden', 'cadde'], ['Gartenweg 4', 'garten', 'yol'], ['Rathausplatz 1', 'rathaus', 'meydan']])('splits %s', (text, key, kind) => {
    expect(parsed(text).street).toMatchObject({ key, kind });
  });

  it.each([['Ленин 5', 'ru'], ['Παπαδόπουλος 5', 'el'], ['محمد 5', 'ar']])('takes the language of the script when no word tells it: %s', (text, language) => {
    expect(parsed(text).language).toBe(language);
  });

  it('does not take a word with digits at its end or a word that only starts with digits for a house number', () => {
    expect(parsed('Bahariye Cad. x12 Kadıköy')).toMatchObject({ houseNumber: null, leftover: ['x12'] });
    expect(parsed('Bahariye Cad. 12abc Kadıköy')).toMatchObject({ houseNumber: null, leftover: ['12abc'] });
  });

  it('reads a block of one letter and up to two digits', () => {
    expect(parsed('Bahariye Cad. A12 Blok No 4 Kadıköy')).toMatchObject({ block: 'a12', houseNumber: '4' });
    expect(parsed('Bahariye Cad. A123 Blok No 4 Kadıköy').block).toBeNull();
    expect(parsed('Bahariye Cad. 1A Blok No 4 Kadıköy').block).toBe('1a');
  });
});

describe('postcodes', () => {
  it('reads five digits with a province plate from 01 to 81', () => {
    expect(parsed('Bahariye Cad. 5 34710 Kadıköy').postcode).toBe('34710');
    expect(parsed('Bahariye Cad. 5 01010 Seyhan').postcode).toBe('01010');
    expect(parsed('Bahariye Cad. 5 81100 Düzce').postcode).toBe('81100');
  });

  it('leaves five digits with a plate outside that range as a number', () => {
    expect(parsed('Bahariye Cad. 5 00100 Kadıköy').postcode).toBeNull();
    expect(parsed('Bahariye Cad. 5 82000 Kadıköy').postcode).toBeNull();
  });

  it('does not take a dotted number, a number after No or a number before a street word', () => {
    expect(parsed('34710. Sk. 5 Kadıköy').postcode).toBeNull();
    expect(parsed('Bahariye Cad. No 34710 Kadıköy')).toMatchObject({ postcode: null, houseNumber: '34710' });
    expect(parsed('34710 Mah. Bahariye Cad. 5').postcode).toBeNull();
    expect(parsed('34710 Cad. 5 Kadıköy').postcode).toBeNull();
  });

  it('does not take the number next to a street or neighbourhood word in marker first languages', () => {
    expect(parsed('улица 34710 д. 5').postcode).toBeNull();
    expect(parsed('микрорайон 34710 улица Ленина 5').postcode).toBeNull();
  });
});

describe('markers that stop a place name', () => {
  it.each(['Kadıköy Kat 2', 'Kadıköy Apt. 5', 'Kadıköy Sitesi', 'Kadıköy Blok A', 'Kadıköy Mah.', 'Kadıköy Cad.'])('does not take the name in %s for a district', (text) => {
    expect(parsed(`${text}, İstanbul`).district).toBeNull();
  });
});

describe('street and neighbourhood names that contain a marker word', () => {
  it('keeps Kapı inside a street name when a street word follows', () => {
    expect(parsed('Hasırlı mah Yeni Kapı Sokak no 58 Sur Diyarbakır')).toMatchObject({ neighbourhood: 'hasirli', street: { key: 'yeni kapi', kind: 'sokak' }, houseNumber: '58' });
    expect(parsed('Dağ Kapı Caddesi 4')).toMatchObject({ street: { key: 'dag kapi', kind: 'cadde' }, houseNumber: '4' });
    expect(parsed('Gül Sk. Kapı No: 7')).toMatchObject({ street: { key: 'gul' }, houseNumber: '7' });
  });

  it('keeps a street word that is the name of the neighbourhood before Mah.', () => {
    expect(parsed('Meydan mah Gümüşdere Sokak no 25 Kütahya Merkez')).toMatchObject({ neighbourhood: 'meydan', street: { key: 'gumusdere', kind: 'sokak' }, houseNumber: '25' });
  });

  it('keeps N Nolu inside a street name that has no street word', () => {
    expect(parsed('Çarşı mah 1 Nolu Barbaros no 5 Rize Merkez Rize')).toMatchObject({ neighbourhood: 'carsi', street: { key: '1 barbaros' }, houseNumber: '5' });
    expect(parsed('Gül Sk. 12 nolu bina 5')).toMatchObject({ street: { key: 'gul' } });
  });
});

