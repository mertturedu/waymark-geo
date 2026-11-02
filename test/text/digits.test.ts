import { nameKey } from '../../src/core/text/fold';
import { numberAsWords, numberWordsToDigits, toAsciiDigits } from '../../src/core/text/digits';

describe('toAsciiDigits', () => {
  it('maps Arabic-Indic, Persian and fullwidth digits', () => {
    expect(toAsciiDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toAsciiDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(toAsciiDigits('０１２３４５６７８９')).toBe('0123456789');
    expect(toAsciiDigits('شارع ١٧ رقم ٣٤')).toBe('شارع 17 رقم 34');
  });

  it('leaves everything else alone', () => {
    expect(toAsciiDigits('Atatürk 12/A')).toBe('Atatürk 12/A');
    expect(toAsciiDigits('')).toBe('');
  });
});

describe('nameKey with other digit systems', () => {
  it('gives the same key for Arabic-Indic and ASCII digits', () => {
    expect(nameKey('شارع ١٧٠٧')).toBe(nameKey('شارع 1707'));
    expect(nameKey('1707 Sokak')).toBe(nameKey('١٧٠٧ Sokak'));
  });
});

const TR_ONES = ['', 'bir', 'iki', 'uc', 'dort', 'bes', 'alti', 'yedi', 'sekiz', 'dokuz'];
const TR_TENS = ['', 'on', 'yirmi', 'otuz', 'kirk', 'elli', 'altmis', 'yetmis', 'seksen', 'doksan'];
const EN_ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const turkishWords = (n: number): string => {
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  if (thousands > 0) parts.push(...(thousands > 1 ? [TR_ONES[thousands] as string] : []), 'bin');
  if (hundreds > 0) parts.push(...(hundreds > 1 ? [TR_ONES[hundreds] as string] : []), 'yuz');
  if (n % 100 >= 10) parts.push(TR_TENS[Math.floor((n % 100) / 10)] as string);
  if (n % 10 > 0) parts.push(TR_ONES[n % 10] as string);
  return parts.join(' ');
};

const englishWords = (n: number): string => {
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const hundreds = Math.floor((n % 1000) / 100);
  const rest = n % 100;
  if (thousands > 0) parts.push(EN_ONES[thousands] as string, 'thousand');
  if (hundreds > 0) parts.push(EN_ONES[hundreds] as string, 'hundred');
  if (rest >= 10 && rest < 20) parts.push(EN_TEENS[rest - 10] as string);
  else {
    if (rest >= 20) parts.push(EN_TENS[Math.floor(rest / 10)] as string);
    if (rest % 10 > 0) parts.push(EN_ONES[rest % 10] as string);
  }
  return parts.join(' ');
};

describe('numberWordsToDigits cardinals', () => {
  it.each([
    ['no elli bes', 'no 55'],
    ['numara yuz yirmi uc', 'numara 123'],
    ['kat bin dokuz yuz', 'kat 1900'],
    ['daire on bir', 'daire 11'],
    ['atatürk caddesi elli bes', 'atatürk caddesi 55'],
    ['kat bir', 'kat 1'],
    ['no bir', 'no 1'],
    ['floor twenty one', 'floor 21'],
    ['number one hundred and five', 'number 105'],
    ['apartment two thousand three hundred', 'apartment 2300'],
    ['block seven', 'block 7'],
  ])('%j -> %j', (input, expected) => {
    expect(numberWordsToDigits(input)).toBe(expected);
  });

  it('turns every Turkish number from 1 to 9999 back into digits after a marker', () => {
    for (let n = 1; n <= 9999; n++) expect(numberWordsToDigits(`no ${turkishWords(n)}`)).toBe(`no ${n}`);
  });

  it('turns every English number from 1 to 9999 back into digits after a marker', () => {
    for (let n = 1; n <= 9999; n++) expect(numberWordsToDigits(`number ${englishWords(n)}`)).toBe(`number ${n}`);
  });

  it('leaves number words that are part of a name alone', () => {
    expect(numberWordsToDigits('iki eylul sokak')).toBe('iki eylul sokak');
    expect(numberWordsToDigits('bir sokak')).toBe('bir sokak');
    expect(numberWordsToDigits('bes yol mahallesi')).toBe('bes yol mahallesi');
    expect(numberWordsToDigits('uc kuyular')).toBe('uc kuyular');
    expect(numberWordsToDigits('one way street')).toBe('one way street');
  });

  it('converts after a street word only when the number ends the phrase', () => {
    expect(numberWordsToDigits('ataturk caddesi elli bes')).toBe('ataturk caddesi 55');
    expect(numberWordsToDigits('ataturk caddesi elli bes kat 2')).toBe('ataturk caddesi 55 kat 2');
    expect(numberWordsToDigits('ataturk caddesi bes yildiz sitesi')).toBe('ataturk caddesi bes yildiz sitesi');
    expect(numberWordsToDigits('ataturk caddesi on dokuz mayis sitesi')).toBe('ataturk caddesi on dokuz mayis sitesi');
  });

  it('stops a run where two plain digits would run together', () => {
    expect(numberWordsToDigits('no bir iki')).toBe('no 1 iki');
    expect(numberWordsToDigits('no yirmi otuz')).toBe('no 20 otuz');
  });

  it('leaves text without number words and empty input unchanged', () => {
    expect(numberWordsToDigits('')).toBe('');
    expect(numberWordsToDigits('ataturk caddesi 12 daire 3')).toBe('ataturk caddesi 12 daire 3');
    expect(numberWordsToDigits('no')).toBe('no');
  });
});

describe('numberWordsToDigits ordinals', () => {
  it.each([
    ['birinci sokak', '1 sokak'],
    ['ikinci cadde', '2 cadde'],
    ['yirmi birinci sokak', '21 sokak'],
    ['yuzuncu sokak', '100 sokak'],
    ['ucuncu kat', '3 kat'],
    ['first street', '1 street'],
    ['second floor', '2 floor'],
    ['twenty first street', '21 street'],
    ['1. sokak', '1 sokak'],
    ['1707. sk', '1707 sk'],
    ['21st street', '21 street'],
    ['2nd floor', '2 floor'],
    ['3rd avenue', '3 avenue'],
    ['4th street', '4 street'],
  ])('%j -> %j', (input, expected) => {
    expect(numberWordsToDigits(input)).toBe(expected);
  });

  it('does not touch ordinals inside a name', () => {
    expect(numberWordsToDigits('yuzuncu yil bulvari')).toBe('yuzuncu yil bulvari');
    expect(numberWordsToDigits('birinci ordu komutanligi')).toBe('birinci ordu komutanligi');
  });
});

describe('numberAsWords', () => {
  it('writes a number up to 99 as a Turkish cardinal and ordinal', () => {
    expect(numberAsWords(8)).toEqual(['sekiz', 'sekizinci']);
    expect(numberAsWords(10)).toEqual(['on', 'onuncu']);
    expect(numberAsWords(21)).toEqual(['yirmi bir', 'yirmi birinci']);
    expect(numberAsWords(99)).toEqual(['doksan dokuz', 'doksan dokuzuncu']);
  });

  it('gives nothing outside 1 to 99', () => {
    for (const n of [0, -3, 100, 2.5, Number.NaN]) expect(numberAsWords(n)).toEqual([]);
  });

  it('reads the ordinal back to the same number through the existing conversion', () => {
    for (let n = 1; n <= 99; n++) expect(numberWordsToDigits(`${numberAsWords(n)[1]} sokak`)).toBe(`${n} sokak`);
  });
});

