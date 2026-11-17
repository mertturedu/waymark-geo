import { createNeighbourhoods, hoodKey, NEIGHBOURHOOD_CACHE, splitHoodName, type NeighbourhoodShard } from '../../src/core/address/neighbourhoods';
import { parseAddress } from '../../src/core/text';
import { sampleShard, sampleSource } from './helpers/neighbourhood-fixture';

describe('hoodKey', () => {
  it('drops the neighbourhood word, the village note and the case', () => {
    expect(hoodKey('Moda Mah')).toBe('moda');
    expect(hoodKey('MODA MAHALLESİ')).toBe('moda');
    expect(hoodKey('Moda Mah.')).toBe('moda');
    expect(hoodKey('Zeytinlik (Çınar Köyü)')).toBe('zeytinlik');
    expect(hoodKey('Ortaköy Beldesi')).toBe('ortakoy');
  });

  it('folds Turkish letters so typed ASCII still matches', () => {
    expect(hoodKey('ÇINARLIK')).toBe('cinarlik');
    expect(hoodKey('Cinarlik')).toBe('cinarlik');
    expect(hoodKey('Hasanpaşa')).toBe(hoodKey('HASANPASA'));
    expect(hoodKey('İstiklal')).toBe(hoodKey('istiklal'));
  });

  it('keeps a name that is only a suffix word and ignores empty input', () => {
    expect(hoodKey('Mah')).toBe('mah');
    expect(hoodKey('')).toBe('');
    expect(hoodKey('   ')).toBe('');
    expect(hoodKey('(Çınar Köyü)')).toBe('');
  });
});

describe('splitHoodName', () => {
  it('separates the village note', () => {
    expect(splitHoodName('Alışlı Mah (Çınarlı Köyü)')).toEqual({ name: 'Alışlı Mah', village: 'Çınarlı Köyü' });
    expect(splitHoodName('Moda')).toEqual({ name: 'Moda', village: null });
    expect(splitHoodName('Moda ()')).toEqual({ name: 'Moda', village: null });
    expect(splitHoodName('Moda (açık')).toEqual({ name: 'Moda (açık', village: null });
  });
});

describe('neighbourhood directory', () => {
  const make = () => {
    const source = sampleSource();
    return { source, hoods: createNeighbourhoods(source) };
  };

  it('lists a district and a whole province', async () => {
    const { hoods } = make();
    expect((await hoods.list('34', 'Kadıköy')).map((h) => h.name)).toEqual(['Moda Mah', 'Hasanpaşa', 'Zeytinlik', 'ÇINARLIK Mahallesi']);
    expect(await hoods.list('34')).toHaveLength(7);
    expect(await hoods.list('34', 'Beşiktaş')).toEqual([]);
    expect(await hoods.list('35')).toEqual([]);
  });

  it('finds a neighbourhood however it is written', async () => {
    const { hoods } = make();
    for (const text of ['Moda', 'moda mahallesi', 'MODA MAH.', 'Hasanpasa', 'cinarlik']) expect((await hoods.find('34', 'Kadıköy', text)).length).toBe(1);
    expect((await hoods.find('34', 'kadikoy', 'Moda'))[0]?.postcode).toBe('34710');
    expect((await hoods.find('34', undefined, 'Fener'))[0]?.postcode).toBe('34660');
    expect(await hoods.find('34', 'Kadıköy', 'Fener')).toEqual([]);
    expect(await hoods.find('34', 'Kadıköy', '')).toEqual([]);
  });

  it('keeps the village of a village neighbourhood', async () => {
    const { hoods } = make();
    expect((await hoods.find('34', 'Kadıköy', 'Zeytinlik'))[0]).toMatchObject({ name: 'Zeytinlik', village: 'Çınar Köyü', postcode: '34720' });
  });

  it('suggests close spellings and stays quiet for exact or far names', async () => {
    const { hoods } = make();
    expect(await hoods.suggest('34', 'Kadıköy', 'Hasanpasaa')).toEqual(['Hasanpaşa']);
    expect(await hoods.suggest('34', 'Kadıköy', 'Modaa')).toEqual(['Moda Mah']);
    expect(await hoods.suggest('34', 'Kadıköy', 'Hasanpaşa')).toEqual([]);
    expect(await hoods.suggest('34', 'Kadıköy', 'Xyzxyzxyz')).toEqual([]);
    expect(await hoods.suggest('34', 'Kadıköy', 'ab')).toEqual([]);
    expect(await hoods.suggest('34', undefined, 'Selamialii')).toEqual(['Selamiali']);
    expect(await hoods.suggest('34', 'Üsküdar', 'Hasanpasaa')).toEqual([]);
  });

  it('allows two edits only for longer names and respects the limit', async () => {
    const { hoods } = make();
    expect(await hoods.suggest('34', 'Kadıköy', 'Hasanpsaa')).toEqual(['Hasanpaşa']);
    expect(await hoods.suggest('34', 'Kadıköy', 'Mdoaa')).toEqual([]);
    expect((await hoods.suggest('34', undefined, 'Cinarlikk', 1)).length).toBe(1);
  });

  it('answers the postcode of a neighbourhood only when it is unique', async () => {
    const { hoods } = make();
    expect(await hoods.postcodeOf('34', 'Kadıköy', 'Moda')).toBe('34710');
    expect(await hoods.postcodeOf('34', 'Kadıköy', 'Bilinmeyen')).toBeNull();
    const twice: NeighbourhoodShard = { v: 1, plate: '06', districts: [{ name: 'Çankaya', groups: [['06100', ['Yıldız']], ['06200', ['Yıldız']]] }] };
    expect(await createNeighbourhoods(sampleSource({ '06': twice })).postcodeOf('06', 'Çankaya', 'Yıldız')).toBeNull();
  });

  it('maps a postcode to its areas', () => {
    const { hoods } = make();
    expect(hoods.areasOf('34710')).toEqual([{ plate: '34', district: 'Kadıköy' }]);
    expect(hoods.areasOf('34720')).toEqual([{ plate: '34', district: 'Kadıköy' }, { plate: '34', district: 'Üsküdar' }]);
    expect(hoods.areasOf('99999')).toEqual([]);
  });

  it('loads a province once, drops old ones and survives bad data', async () => {
    const shards: Record<string, NeighbourhoodShard> = {};
    for (let i = 1; i <= NEIGHBOURHOOD_CACHE + 2; i++) {
      const plate = String(i).padStart(2, '0');
      shards[plate] = { v: 1, plate, districts: [{ name: 'Merkez', groups: [[`${plate}100`, ['Yeni']]] }] };
    }
    const source = sampleSource({ ...shards, '90': { ...sampleShard, v: 2 as 1 } });
    const hoods = createNeighbourhoods(source);
    await Promise.all([hoods.list('01'), hoods.list('01')]);
    await hoods.list('01');
    expect(source.loads).toEqual(['01']);
    for (let i = 2; i <= NEIGHBOURHOOD_CACHE + 2; i++) await hoods.list(String(i).padStart(2, '0'));
    await hoods.list('01');
    expect(source.loads.filter((p) => p === '01')).toHaveLength(2);
    expect(await hoods.list('90')).toEqual([]);
    const broken = createNeighbourhoods({ index: source.index, load: async () => { throw new Error('offline'); } });
    expect(await broken.list('34')).toEqual([]);
    hoods.clear();
    await hoods.list('01');
    expect(source.loads.filter((p) => p === '01')).toHaveLength(3);
  });
});

describe('fillArea', () => {
  const { hoods } = { hoods: createNeighbourhoods(sampleSource()) };

  it('takes province and district from a postcode that points at one place', () => {
    const parsed = hoods.fillArea(parseAddress('Moda Mah 34710'));
    expect(parsed.province?.id).toBe('34');
    expect(parsed.district?.name).toBe('Kadıköy');
  });

  it('fills only the province when the postcode spans districts', () => {
    const parsed = hoods.fillArea(parseAddress('Moda Mah 34720'));
    expect(parsed.province?.id).toBe('34');
    expect(parsed.district).toBeNull();
  });

  it('leaves the address alone when nothing can be told', () => {
    const unknown = parseAddress('Moda Mah 34999');
    expect(hoods.fillArea(unknown)).toBe(unknown);
    const none = parseAddress('Moda Mah');
    expect(hoods.fillArea(none)).toBe(none);
    const full = parseAddress('Moda Mah 34710 Kadıköy İstanbul');
    expect(hoods.fillArea(full)).toBe(full);
  });

  it('does not override a province or district the user typed', () => {
    const typed = hoods.fillArea(parseAddress('Moda Mah 34710 Üsküdar'));
    expect(typed.district?.name).toBe('Üsküdar');
    const other = parseAddress('Moda Mah 34710 Ankara');
    expect(hoods.fillArea(other).province?.id).toBe(other.province?.id);
  });
});

describe('checkPostcode', () => {
  const hoods = createNeighbourhoods(sampleSource());

  it('flags a postcode that belongs to another neighbourhood', async () => {
    expect(await hoods.checkPostcode(parseAddress('Moda Mah 34660'), '34', 'Kadıköy')).toEqual({ typed: '34660', expected: ['34710'] });
  });

  it('accepts the right postcode and stays quiet without enough to compare', async () => {
    expect(await hoods.checkPostcode(parseAddress('Moda Mah 34710'), '34', 'Kadıköy')).toBeNull();
    expect(await hoods.checkPostcode(parseAddress('Moda Mah'), '34', 'Kadıköy')).toBeNull();
    expect(await hoods.checkPostcode(parseAddress('34710'), '34', 'Kadıköy')).toBeNull();
    expect(await hoods.checkPostcode(parseAddress('Bilinmeyen Mah 34710'), '34', 'Kadıköy')).toBeNull();
  });
});
