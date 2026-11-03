import { upperTr } from '../../src/core/text';

describe('upperTr', () => {
  it.each([
    ['istiklal', 'İSTİKLAL'],
    ['ılgaz', 'ILGAZ'],
    ['çeşme', 'ÇEŞME'],
    ['ğöşüçı', 'ĞÖŞÜÇI'],
    ['Şerif Bey Çeşmesi Sokağı', 'ŞERİF BEY ÇEŞMESİ SOKAĞI'],
    ['İzmir', 'İZMİR'],
    ['Kadıköy 12/A', 'KADIKÖY 12/A'],
    ['cumhuriyet mahallesi', 'CUMHURİYET MAHALLESİ'],
    ['âlem', 'ÂLEM'],
    ['straße', 'STRASSE'],
    ['москва', 'МОСКВА'],
    ['αθήνα', 'ΑΘΉΝΑ'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(upperTr(input)).toBe(expected);
  });

  it('keeps characters it has no rule for', () => {
    expect(upperTr('الجزائر 東京 ⛽')).toBe('الجزائر 東京 ⛽');
  });
});
