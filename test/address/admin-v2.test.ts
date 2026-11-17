import { hoodAliases, formerHoodPlates } from '../../src/core/address/aliases';
import { createSearch, type Search } from '../../src/core/address/search';
import type { Region } from '../../src/core/address/pack';
import { findDistrict, findProvince } from '../../src/core/text/admin';
import aliases from '../../src/core/text/data/admin-aliases.json';
import { address, where } from '../pipeline/helpers/mini-work';
import { builtPack, memoryStore, searchRows, turkeyBorders } from './helpers/search-fixture';

let search: Search;
let closeStore: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  const rows = searchRows();
  rows.addresses.push(
    address('n701', 'Papatya Sokak', '5', 28.7, 40.8, where('r10', 'r20'), { postcode: '34710' }),
    address('n702', 'Papatya Sokak', '5', 29.2, 40.8, where('r11', 'r21'), { postcode: '34674' }),
    address('n703', 'Papatya Sokak', '7', 29.2002, 40.8, where('r11', 'r21'), { postcode: '34674' }),
    address('n704', 'Menekşe Sokak', '9', 28.71, 40.81, where('r10', 'r20'), { postcode: '34710' }),
  );
  const { store, close } = await memoryStore({ '34': await builtPack(rows) });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const best = async (text: string, options = {}) => {
  const result = await search.resolve(text, options);
  return result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
};

describe('old and alternative province and district names', () => {
  it('reads a former or short province name', () => {
    expect(findProvince('Urfa')).toMatchObject({ id: '63' });
    expect(findProvince('Maraş')).toMatchObject({ id: '46' });
    expect(findProvince('Dersim')).toMatchObject({ id: '62' });
  });

  it('reads an alternative district name inside its province only', () => {
    expect(findDistrict('Eyüp', '34').map((d) => d.name)).toEqual(['Eyüpsultan']);
    expect(findDistrict('Eyüp', '06')).toEqual([]);
  });

  it('keeps generic words out of the alias lists', () => {
    const generic = Object.values(aliases.district).flatMap((d) => Object.values(d)).flat().filter((a) => a.length < 3);
    expect(generic).toEqual([]);
  });
});

describe('former neighbourhood names', () => {
  it('indexes the aliases of the hoods a region has', () => {
    const [plate, districts] = Object.entries(aliases.hood as Record<string, Record<string, Record<string, string[]>>>)[0] as [string, Record<string, Record<string, string[]>>];
    const [districtKey, hoods] = Object.entries(districts)[0] as [string, Record<string, string[]>];
    const [hoodKey, list] = Object.entries(hoods)[0] as [string, string[]];
    const region = { id: plate, districts: [{ id: 1, key: districtKey }], hoods: [{ id: 7, districtId: 1, key: hoodKey }] } as unknown as Region;
    expect(hoodAliases(region).get(list[0] as string)).toEqual([7]);
    expect(formerHoodPlates(list[0] as string)).toContain(plate);
  });

  it('reuses the index of a region and copes with a province that has no aliases', () => {
    const region = { id: '99', districts: [{ id: 1, key: 'x' }], hoods: [{ id: 1, districtId: 1, key: 'y' }] } as unknown as Region;
    expect(hoodAliases(region).size).toBe(0);
    expect(hoodAliases(region)).toBe(hoodAliases(region));
  });

  it('finds a plate when the alias is typed with a space the data does not have', () => {
    const all = Object.values(aliases.hood as Record<string, Record<string, Record<string, string[]>>>).flatMap((d) => Object.values(d).flatMap((h) => Object.values(h).flat()));
    const alias = all.find((a) => a.length >= 6 && !a.includes(' ')) as string;
    expect(alias).toBeDefined();
    expect(formerHoodPlates(alias).length).toBeGreaterThan(0);
    expect(formerHoodPlates(`${alias.slice(0, 3)} ${alias.slice(3)}`).length).toBeGreaterThan(0);
  });

  it('finds nothing for a name nobody used', () => {
    expect(formerHoodPlates('hicbirmahalleninadi')).toEqual([]);
  });
});

describe('a district that does not fit the street', () => {
  it('finds a street that exists in one other district and says so', async () => {
    const place = await best('Menekşe Sokak 9 Üsküdar İstanbul');
    expect(place).toMatchObject({ approximate: true, notes: ['district_mismatch'], components: { district: 'Kadıköy', street: 'Menekşe Sokak' } });
  });

  it('does not say it for a district that fits', async () => {
    const place = await best('Menekşe Sokak 9 Kadıköy İstanbul');
    expect(place?.notes).toBeUndefined();
    expect(place).toMatchObject({ precision: 'address', components: { district: 'Kadıköy' } });
  });
});

describe('postcode', () => {
  it('prefers the neighbourhood that carries the written postcode', async () => {
    const west = await best('Papatya Sokak 5 34710', { hints: { city: 'İstanbul' } });
    const east = await best('Papatya Sokak 5 34674', { hints: { city: 'İstanbul' } });
    expect(west?.components.district).toBe('Kadıköy');
    expect(east?.components.district).toBe('Üsküdar');
  });
});
