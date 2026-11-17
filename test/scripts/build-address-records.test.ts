import { isCleanStreet, sampleRecords, type RawRecord } from '../../scripts/build-address-records';

const raw = (over: Partial<RawRecord> & Pick<RawRecord, 'street' | 'houseNumber'>): RawRecord => ({
  province: '34',
  provinceName: 'İstanbul',
  district: 'Kadıköy',
  districtNames: { tr: 'Kadıköy' },
  neighbourhood: 'Moda',
  neighbourhoodNames: { tr: 'Moda' },
  lon: 29,
  lat: 41,
  ...over,
});

const many = (plate: string, name: string, count: number): RawRecord[] =>
  Array.from({ length: count }, (_, i) => raw({ province: plate, provinceName: name, street: `Sokak ${i}`, houseNumber: String(i + 1) }));

describe('isCleanStreet', () => {
  it.each(['Bahariye Caddesi', 'Gül Sokak', '1707 Sokak', '1. Sokak', 'Şht. Hayrettin Eren Caddesi', 'İzmir-Çeşme Yolu', 'Gazililer Sitesi 1. Sokak', '4. Levent Caddesi', 'Kazım Dirik'])('keeps %s', (name) => {
    expect(isCleanStreet(name)).toBe(true);
  });

  it.each(['İskele mh Fehim Aytekin Cd', 'Cumhuriyet Mah. Şişecam Yolu Sokak', 'Konak Mah.Şerifağa Sok.', 'Barbaros Cad. Akseki Sitesi A Blok', 'Refik Bozturk Apt. Sokak', 'Şemsi Tebrizi Mahallesi - Sultan Veled Caddesi', 'D130-1DEVLETKARAYOLU', '2416.CADDE 2402 Sokak'])('drops %s', (name) => {
    expect(isCleanStreet(name)).toBe(false);
  });
});

describe('sampleRecords', () => {
  const rows = [...many('34', 'İstanbul', 600), ...many('06', 'Ankara', 40)];

  it('takes at most the limit from each province and all of a small one', () => {
    const { records, stats } = sampleRecords(rows, 250, 7);
    expect(records.filter((r) => r.province === '34')).toHaveLength(250);
    expect(records.filter((r) => r.province === '06')).toHaveLength(40);
    expect(stats).toEqual([
      { province: '06', name: 'Ankara', available: 40, taken: 40 },
      { province: '34', name: 'İstanbul', available: 600, taken: 250 },
    ]);
  });

  it('is deterministic and changes with the seed', () => {
    const a = JSON.stringify(sampleRecords(rows, 250, 7).records);
    expect(JSON.stringify(sampleRecords([...rows].reverse(), 250, 7).records)).toBe(a);
    expect(JSON.stringify(sampleRecords(rows, 250, 8).records)).not.toBe(a);
  });

  it('writes the district under its official name', () => {
    const { records } = sampleRecords([raw({ province: '05', provinceName: 'Amasya', district: 'Amasya', districtNames: { tr: 'Amasya' }, street: 'Gül Sokak', houseNumber: '3' })], 10, 1);
    expect(records[0]?.district).toBe('Merkez');
  });

  it('drops unusable records and exact duplicates', () => {
    const { records } = sampleRecords(
      [
        raw({ street: 'Gül Sokak', houseNumber: '3' }),
        raw({ street: 'Gül Sokak', houseNumber: '3' }),
        raw({ street: '', houseNumber: '4' }),
        raw({ street: 'A', houseNumber: '5' }),
        raw({ street: 'Gül Sokak', houseNumber: 'yok' }),
        raw({ street: 'Gül Sokak', houseNumber: '1234567890123' }),
        raw({ street: 'Gül Sokak', houseNumber: '12/A' }),
        raw({ street: 'Gül Sokak', houseNumber: '14-16' }),
        raw({ street: 'Gül Sokak, Fethiye Mah.', houseNumber: '8' }),
        raw({ street: 'Corner Kat:2 Daire:24', houseNumber: '9' }),
        raw({ street: 'Cumhuriyet Cad.720.Sok.', houseNumber: '10' }),
        raw({ street: '379', houseNumber: '11' }),
        raw({ district: 'Kara Ada', province: '48', provinceName: 'Muğla', street: 'Deniz Sokak', houseNumber: '1' }),
      ],
      10,
      1,
    );
    expect(records.map((r) => r.houseNumber).sort()).toEqual(['12/A', '14-16', '3']);
  });

  it('keeps the other languages and the neighbourhood', () => {
    const { records } = sampleRecords([raw({ street: 'Gül Sokak', houseNumber: '3', districtNames: { tr: 'Kadıköy', ru: 'Кадыкёй' }, neighbourhoodNames: { tr: 'Moda', en: 'Moda Neighborhood' } })], 10, 1);
    expect(records[0]).toEqual({
      province: '34',
      provinceName: 'İstanbul',
      district: 'Kadıköy',
      districtNames: { tr: 'Kadıköy', ru: 'Кадыкёй' },
      neighbourhood: 'Moda',
      neighbourhoodNames: { tr: 'Moda', en: 'Moda Neighborhood' },
      street: 'Gül Sokak',
      houseNumber: '3',
    });
  });
});
