import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { foldText, nameKey } from '../../src/core/text/fold';
import { scriptOf, transliterate } from '../../src/core/text/translit';

const key = (text: string) => transliterate(foldText(text));

describe('transliterate Cyrillic', () => {
  it.each([
    ['Ататюрк', 'ataturk'],
    ['Кадыкёй', 'kadikoy'],
    ['Ёмер', 'omer'],
    ['Кечиёрен', 'kecioren'],
    ['Бююк Чамлыджа', 'buyuk camlica'],
    ['Юксел', 'yuksel'],
    ['Шишли', 'sisli'],
    ['Чайыр', 'cayir'],
    ['Джамлыджа', 'camlica'],
    ['Эрдоган', 'erdogan'],
    ['Жандарма', 'jandarma'],
    ['Яшар', 'yasar'],
    ['Ыхламур', 'ihlamur'],
    ['Щука', 'suka'],
    ['объект', 'obekt'],
    ['Подъезд', 'podezd'],
  ])('%s -> %s', (input, expected) => {
    expect(key(input)).toBe(expected);
  });

  it('writes ю as u after a consonant and yu at the start or after a vowel', () => {
    expect(key('тю')).toBe('tu');
    expect(key('ю')).toBe('yu');
    expect(key('аю')).toBe('ayu');
    expect(key(' ю')).toBe('yu');
  });

  it('turns улица and проспект into stable Latin words', () => {
    expect(key('улица')).toBe('ulica');
    expect(key('проспект')).toBe('prospekt');
  });
});

describe('transliterate Greek', () => {
  it.each([
    ['Ατατούρκ', 'ataturk'],
    ['Μπαχτσέ', 'bahce'],
    ['Σισλί', 'sisli'],
    ['Ντενίζ', 'deniz'],
    ['Γκιουλ', 'gul'],
    ['Τσεσμέ', 'cesme'],
    ['Κετσιορεν', 'kecioren'],
    ['Τζαμί', 'cami'],
    ['Χασάν', 'hasan'],
    ['Ουσκουντάρ', 'uskudar'],
    ['Οδός Ατατούρκ', 'odos ataturk'],
    ['Χάταϊ', 'hatay'],
    ['Σεϊχσινάν', 'seyhsinan'],
    ['Αϊβαλί', 'ayvali'],
  ])('%s -> %s', (input, expected) => {
    expect(key(input)).toBe(expected);
  });
});

describe('transliterate leaves the rest alone', () => {
  it('keeps Latin, digits and Arabic untouched', () => {
    expect(transliterate('kadikoy 12')).toBe('kadikoy 12');
    expect(transliterate('شارع 5')).toBe('شارع 5');
    expect(transliterate('')).toBe('');
  });

  it('drops letters it has no rule for instead of guessing', () => {
    expect(transliterate('a԰b')).toBe('a԰b');
  });
});

describe('nameKey with other scripts', () => {
  it('maps Cyrillic and Greek spellings onto the Turkish key', () => {
    expect(nameKey('Ататюрк')).toBe(nameKey('Atatürk'));
    expect(nameKey('Ατατούρκ')).toBe(nameKey('Atatürk'));
    expect(nameKey('Бююк Чамлыджа')).toBe(nameKey('Büyük Çamlıca'));
    expect(nameKey('Кадыкёй')).toBe(nameKey('Kadıköy'));
  });

  it('keeps Arabic letters', () => {
    expect(nameKey('شارع أتاتورك')).toBe('شارع اتاتورك');
  });

  it('is idempotent and only emits ASCII or Arabic', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (text) => {
        const k = nameKey(text);
        expect(nameKey(k)).toBe(k);
        expect(k).toMatch(/^[a-z0-9ء-ي٠-٩ٱ-ۓ۰-۹ ]*$/);
      }),
      { numRuns: 3000, seed: 14 },
    );
  });
});

describe('scriptOf', () => {
  it.each([
    ['Kadıköy', 'latin'],
    ['Кадыкёй', 'cyrillic'],
    ['Κωνσταντινούπολη', 'greek'],
    ['شارع أتاتورك', 'arabic'],
    ['شارع أتاتورك Kadıköy 12', 'arabic'],
    ['شارع Atatürk 12', 'latin'],
    ['Atatürk شارع', 'latin'],
    ['улица Atatürk', 'latin'],
    ['12 / 3', 'other'],
    ['', 'other'],
    ['😀', 'other'],
  ])('%s is %s', (text, script) => {
    expect(scriptOf(text)).toBe(script);
  });
});

describe('transliteration against OpenStreetMap names', () => {
  const pairs = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/translit-pairs.json'), 'utf8')) as { ru: [string, string][]; el: [string, string][] };
  const rate = (list: [string, string][]) => list.filter(([turkish, other]) => nameKey(turkish) === nameKey(other)).length / list.length;

  it('keeps the Russian rules at or above the measured agreement', () => {
    expect(pairs.ru.length).toBeGreaterThan(600);
    expect(rate(pairs.ru)).toBeGreaterThanOrEqual(0.98);
  });

  it('keeps the Greek rules at or above the measured agreement (most OSM Greek names are historic names, not spellings)', () => {
    expect(pairs.el.length).toBeGreaterThan(200);
    expect(rate(pairs.el)).toBeGreaterThanOrEqual(0.5);
  });

  it.each([
    ['Hakkâri', 'Хаккяри'],
    ['Elâzığ', 'Элязыг'],
    ['Afyonkarahisar', 'Афьонкарахисар'],
    ['Yenişehir', 'Енишехир'],
    ['Sarıyer', 'Сарыер'],
    ['Osmaniye', 'Османие'],
    ['Antalya', 'Анталья'],
    ['Konyaaltı', 'Коньяалты'],
    ['Esenyurt', 'Эсеньюрт'],
    ['Midyat', 'Мидьят'],
    ['Gümüşhane', 'Γκιουμούσχανε'],
    ['Yozgat', 'Γιοζγκάτ'],
    ['Osmaniye', 'Οσμανίγιε'],
  ])('writes %s the same as %s', (turkish, other) => {
    expect(nameKey(other)).toBe(nameKey(turkish));
  });
});
