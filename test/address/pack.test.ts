import { openSqlite } from '../../src/node/sqlite';
import { MAX_CODES, openRegion, rarest } from '../../src/core/address/pack';
import { streetKey } from '../../src/core/text/street';
import { address, baseRows, where } from '../pipeline/helpers/mini-work';
import { miniRegion, richRows } from './helpers/mini-pack';

describe('openRegion', () => {
  it('reads the region id, districts, neighbourhoods and the place kinds once', async () => {
    const { region, close } = await miniRegion();
    expect(region.id).toBe('34');
    expect(region.districts.map((d) => [d.id, d.name, d.key])).toEqual([[1, 'Kadıköy', 'kadikoy'], [2, 'Üsküdar', 'uskudar']]);
    expect(region.districts[0]?.center[0]).toBeCloseTo(28.7, 6);
    expect(region.hoods.map((h) => [h.id, h.districtId, h.name, h.key])).toEqual([[1, 1, 'Moda', 'moda'], [2, 2, 'Fener', 'fener'], [3, 1, 'Bahariye', 'bahariye']]);
    expect(region.hoods[2]?.center?.[0]).toBeCloseTo(28.805, 3);
    expect(region.kinds.get(1)).toBe('bank');
    await close();
  });

  it('refuses a database that is not a pack', async () => {
    const { file, close } = await miniRegion();
    await close();
    const db = openSqlite(file);
    await db.close();
    await expect(openRegion(db)).rejects.toThrow();
  });
});

describe('streetCandidates', () => {
  it('finds the name for the exact key, for a missing letter and for a wrong one, most shared pieces first', async () => {
    const { region, close } = await miniRegion();
    const exact = await region.streetCandidates('ataturk', 'street');
    expect(exact.map((c) => c.key)).toContain('ataturk');
    expect(exact[0]?.shared).toBeGreaterThanOrEqual(exact[exact.length - 1]?.shared ?? 0);
    expect((await region.streetCandidates('atatrk', 'street')).map((c) => c.key)).toContain('ataturk');
    expect((await region.streetCandidates('ataturc', 'street')).map((c) => c.key)).toContain('ataturk');
    await close();
  });

  it('keeps streets and places apart and obeys the limit', async () => {
    const { region, close } = await miniRegion();
    expect((await region.streetCandidates('devlet hastanesi', 'street')).map((c) => c.key)).not.toContain('devlet hastanesi');
    expect((await region.streetCandidates('devlet hastanesi', 'poi')).map((c) => c.key)).toContain('devlet hastanesi');
    expect(await region.streetCandidates('a', 'street', 1)).toHaveLength(1);
    await close();
  });

  it('returns nothing for an empty key and does not fail on odd text', async () => {
    const { region, close } = await miniRegion();
    expect(await region.streetCandidates('', 'street')).toEqual([]);
    expect(await region.streetCandidates("'; DROP TABLE tri; --", 'street')).toEqual([]);
    expect(await region.streetCandidates('x'.repeat(500), 'street')).toEqual([]);
    expect((await region.streetCandidates('ataturk', 'street')).length).toBeGreaterThan(0);
    await close();
  });

  it('gives the same answer twice', async () => {
    const { region, close } = await miniRegion();
    expect(await region.streetCandidates('gul', 'street')).toEqual(await region.streetCandidates('gul', 'street'));
    await close();
  });
});

describe('allNames', () => {
  it('lists every search name of a kind in id order', async () => {
    const { region, close } = await miniRegion();
    const streets = await region.allNames('street');
    expect(streets.map((n) => n.nameId)).toEqual([...streets.map((n) => n.nameId)].sort((a, b) => a - b));
    expect(streets.map((n) => n.key)).toEqual(expect.arrayContaining(['ataturk', 'bahariye', 'gul', 'cumhuriyet']));
    expect((await region.allNames('poi')).map((n) => n.key)).toContain('gul eczanesi');
    await close();
  });
});

describe('street, address and part queries', () => {
  it('reads streets by id with their key, kind and number', async () => {
    const { region, close } = await miniRegion();
    const bahariye = (await region.allNames('street')).find((n) => n.key === 'bahariye');
    const [row] = await region.streetsByIds([bahariye?.ref as number]);
    expect(row).toMatchObject({ name: 'Bahariye Caddesi', key: 'bahariye', kind: 'cadde', number: null });
    expect(await region.streetsByIds([])).toEqual([]);
    await close();
  });

  it('tells in which districts and neighbourhoods a street exists', async () => {
    const { region, close } = await miniRegion();
    const gul = (await region.allNames('street')).find((n) => n.key === 'gul');
    const places = await region.hoodsOfStreet([gul?.ref as number]);
    expect(places.map((p) => [p.districtId, p.hoodId]).sort()).toEqual([[1, 1], [2, 2]]);
    await close();
  });

  it('also tells the places of a street that exists only through its addresses', async () => {
    const rows = baseRows();
    rows.streets = [];
    rows.addresses = [address('n1', 'Tek Sokak', '5', 28.6, 40.7, where('r10', 'r20')), address('n2', 'Tek Sokak', '7', 29.1, 40.7, where('r11', 'r21'))];
    const { region, close } = await miniRegion(rows);
    const tek = (await region.allNames('street'))[0]?.ref as number;
    expect((await region.hoodsOfStreet([tek])).map((p) => [p.districtId, p.hoodId])).toEqual([[1, 1], [2, 2]]);
    await close();
  });

  it('finds the rows of one door number on one street, also written differently', async () => {
    const { region, close } = await miniRegion();
    const bahariye = (await region.allNames('street')).find((n) => n.key === 'bahariye')?.ref as number;
    expect((await region.addressesOf(bahariye, '14')).map((a) => [a.number, a.hoodId])).toEqual([['14', 1]]);
    expect(await region.addressesOf(bahariye, '15')).toEqual([]);
    expect(await region.addressesOf(999999, '14')).toEqual([]);
    await close();
  });

  it('finds a door with no street through its neighbourhood', async () => {
    const { region, close } = await miniRegion();
    const rows = await region.addressesWithoutStreet(1, '7');
    expect(rows.map((a) => [a.streetId, a.number])).toEqual([[null, '7']]);
    expect(await region.addressesWithoutStreet(2, '7')).toEqual([]);
    await close();
  });

  it('lists the numbers of a street on one side only, in order', async () => {
    const { region, close } = await miniRegion();
    const bahariye = (await region.allNames('street')).find((n) => n.key === 'bahariye')?.ref as number;
    const even = await region.neighbours(bahariye, 0);
    expect(even.map((a) => a.num)).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(even.every((a) => a.parity === 0)).toBe(true);
    const odd = await region.neighbours(bahariye, 1);
    expect(odd.map((a) => a.num)).toEqual([1, 3, 5, 7, 9]);
    expect((await region.neighbours(bahariye, null)).map((a) => a.num)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20]);
    await close();
  });

  it('gives the lines of the parts of a street with their place', async () => {
    const { region, close } = await miniRegion();
    const gul = (await region.allNames('street')).find((n) => n.key === 'gul')?.ref as number;
    const parts = await region.partsOf(gul);
    expect(parts.map((p) => [p.districtId, p.hoodId])).toEqual([[1, 1], [2, 2]]);
    expect(parts[0]?.lines).toEqual([[[28.6, 40.7], [28.7, 40.7]]]);
    await close();
  });

  it('reads places by id with their kind and place', async () => {
    const { region, close } = await miniRegion();
    const name = (await region.allNames('poi')).find((n) => n.key === 'devlet hastanesi');
    const [poi] = await region.poisByIds([name?.ref as number]);
    expect(poi).toMatchObject({ name: 'Devlet Hastanesi', kind: 'hospital', districtId: 1, hoodId: 1 });
    expect(poi?.lng).toBeCloseTo(28.62, 6);
    await close();
  });

  it('reads an address pack built with only one street', async () => {
    const rows = baseRows();
    rows.addresses = [address('n1', 'Tek Sokak', '5', 28.6, 40.7)];
    rows.streets = [];
    rows.places = [];
    const { region, close } = await miniRegion(rows);
    expect((await region.allNames('street')).map((n) => n.key)).toEqual(['tek']);
    expect(await region.allNames('poi')).toEqual([]);
    expect(streetKey('Tek Sokak').key).toBe('tek');
    await close();
  });

  it('reads the richer fixture too', () => {
    expect(richRows().addresses.length).toBeGreaterThan(baseRows().addresses.length);
    expect(address('n1', 'x', '1', 1, 1, where('r10', 'r20')).id).toBe('n1');
  });
});

describe('rarest', () => {
  it('keeps every code when there are few and otherwise the ones with the shortest lists', () => {
    const sizes = new Map([[1, 50], [2, 5], [3, 5], [4, 900], [5, 1]]);
    expect(rarest([1, 2, 3, 4, 5], sizes, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(rarest([1, 2, 3, 4, 5], sizes, 3)).toEqual([2, 3, 5]);
    expect(rarest([1, 2, 3, 4, 5], sizes, 1)).toEqual([5]);
  });

  it('leaves out a code that has no list at all and breaks ties by the smaller code', () => {
    expect(rarest([9, 8, 7], new Map([[8, 4], [9, 4]]), 5)).toEqual([8, 9]);
    expect(rarest([9, 8], new Map([[8, 4], [9, 4]]), 1)).toEqual([8]);
    expect(MAX_CODES).toBeGreaterThanOrEqual(12);
  });
});

describe('streetCandidates with a very short key', () => {
  it('keeps a name that shares a single trigram with the key, so heavy typos still reach it', async () => {
    const rows = baseRows();
    rows.addresses.push(address('n701', 'Yıldız Sokağı', '1', 28.6, 40.7, where('r10', 'r20')));
    const { region, close } = await miniRegion(rows);
    const found = await region.streetCandidates('yldz', 'street');
    expect(found.map((c) => c.key)).toContain('yildiz');
    await close();
  });
});

describe('streetCandidates with a long name', () => {
  it('still finds a long place name when a word of it is misspelled', async () => {
    const rows = baseRows();
    const long = 'Kartal Dr Lütfi Kırdar Eğitim ve Araştırma Hastanesi Poliklinikleri';
    for (let i = 0; i < 40; i++) rows.places.push({ id: `n${700 + i}`, kind: 'hospital', name: `Örnek ${i} Eğitim ve Araştırma Hastanesi`, names: { tr: `Örnek ${i} Eğitim ve Araştırma Hastanesi` }, alt: [], lon: 28.62, lat: 40.62, district: 'r10', neighbourhood: 'r20', hoodName: null, hoodNames: null, hoodSource: 'polygon', slack: false });
    rows.places.push({ id: 'n799', kind: 'hospital', name: long, names: { tr: long }, alt: [], lon: 28.62, lat: 40.62, district: 'r10', neighbourhood: 'r20', hoodName: null, hoodNames: null, hoodSource: 'polygon', slack: false });
    const { region, close } = await miniRegion(rows);
    const found = await region.streetCandidates('kartal dr lutfi kirdar egitim ve arastirma hastane poliklinikleri', 'poi', 5);
    expect(found[0]?.key).toBe('kartal dr lutfi kirdar egitim ve arastirma hastanesi poliklinikleri');
    await close();
  });
});

describe('region reads with nothing to ask for', () => {
  it('answers an empty list without touching the database', async () => {
    const { region, close } = await miniRegion();
    await close();
    expect(await region.streetsByIds([])).toEqual([]);
    expect(await region.hoodsOfStreet([])).toEqual([]);
    expect(await region.addressesInCells([])).toEqual([]);
    expect(await region.partsInCells([])).toEqual([]);
    expect(await region.poisByIds([])).toEqual([]);
  });

  it('reads names that start with a fragment, with a default limit and with an own one', async () => {
    const { region, close } = await miniRegion();
    const all = await region.prefixNames('street', 'bah');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((n) => n.key.startsWith('bah'))).toBe(true);
    expect(await region.prefixNames('street', 'bah', 1)).toHaveLength(1);
    expect(await region.prefixNames('poi', 'bah')).toEqual([]);
    await close();
  });
});

describe('openRegion with a format it does not know', () => {
  it('names the format it found', async () => {
    const { file, close } = await miniRegion();
    await close();
    const db = openSqlite(file);
    const wrong = { all: async (sql: string, args?: unknown[]) => (sql.includes('FROM meta') ? [{ k: 'format', v: '9' }] : db.all(sql, args as never)) as never, close: () => db.close() };
    await expect(openRegion(wrong as never)).rejects.toThrow('desteklenmeyen paket biçimi: 9');
    await db.close();
  });
});
