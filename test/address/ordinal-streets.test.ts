import { createSearch, type Search } from '../../src/core/address/search';
import { address, baseRows, part, where } from '../pipeline/helpers/mini-work';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const rows = baseRows();
  rows.addresses.push(
    address('n801', 'Sekizinci Sokak', '1', 28.61, 40.81, where('r10', 'r20')),
    address('n802', '8. Sokak', '1', 28.62, 40.82, where('r11', 'r21')),
    address('n804', 'Oksan Sokağı', '1', 28.64, 40.84, where('r10', 'r20')),
    address('n803', 'Yirmi Birinci Sokak', '4', 28.63, 40.83, where('r10', 'r20')),
  );
  rows.streets.push(
    part('Sekizinci Sokak', where('r10', 'r20'), [[[28.61, 40.81], [28.611, 40.81]]], ['w801']),
    part('8. Sokak', where('r11', 'r21'), [[[28.62, 40.82], [28.621, 40.82]]], ['w802']),
    part('Oksan Sokağı', where('r10', 'r20'), [[[28.64, 40.84], [28.641, 40.84]]], ['w804']),
    part('Yirmi Birinci Sokak', where('r10', 'r20'), [[[28.63, 40.83], [28.631, 40.83]]], ['w803']),
  );
  const { store, close } = await memoryStore({ '34': await builtPack(rows) });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const streets = async (text: string): Promise<string[]> => {
  const result = await search.resolve(text);
  return result.status === 'region_missing' ? [] : result.candidates.map((c) => `${c.components.street}/${c.components.houseNumber ?? '-'}`);
};

describe('streets whose name is a spelled out number', () => {
  it('finds the street by its own words', async () => {
    expect((await streets('Sekizinci Sokak No 1'))[0]).toBe('Sekizinci Sokak/1');
    expect((await streets('Yirmi Birinci Sokak 4'))[0]).toBe('Yirmi Birinci Sokak/4');
  });

  it('still finds the numbered street by its digits, and the spelled out one as another candidate', async () => {
    const list = await streets('8. Sokak No 1');
    expect(list[0]).toBe('8. Sokak/1');
    expect(list).toContain('Sekizinci Sokak/1');
  });

  it('does not take a street whose name only looks like the spelled out number', async () => {
    const list = await streets('90. Sokak No 1');
    expect(list.some((x) => x.startsWith('Oksan'))).toBe(false);
  });
});
