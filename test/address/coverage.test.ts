import { DatabaseSync } from 'node:sqlite';
import { COVERAGE_MIN_ADDRESSES, COVERAGE_MIN_STREETS, coverageLevel, shortHoodName } from '../../src/core/address/coverage';
import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let search: Search;
let file = '';
let closeStore: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  file = await builtPack();
  const { store, close } = await memoryStore({ '34': file });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const sql = <T>(query: string): T[] => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(query).all() as T[];
  } finally {
    db.close();
  }
};

describe('coverageLevel', () => {
  it('calls a district sparse below either minimum and rich at or above both', () => {
    expect(COVERAGE_MIN_STREETS).toBe(300);
    expect(COVERAGE_MIN_ADDRESSES).toBe(30);
    expect(coverageLevel(300, 30)).toBe('rich');
    expect(coverageLevel(299, 30)).toBe('sparse');
    expect(coverageLevel(300, 29)).toBe('sparse');
    expect(coverageLevel(0, 0)).toBe('sparse');
    expect(coverageLevel(5000, 5000)).toBe('rich');
  });
});

describe('shortHoodName', () => {
  it('drops the neighbourhood word at the end and keeps the rest', () => {
    expect(shortHoodName('Moda Mahallesi')).toBe('Moda');
    expect(shortHoodName('Çatlar Mahalesi')).toBe('Çatlar');
    expect(shortHoodName('Hamam Mah.')).toBe('Hamam');
    expect(shortHoodName('Yeni Mah')).toBe('Yeni');
    expect(shortHoodName('  Çarşı  ')).toBe('Çarşı');
    expect(shortHoodName('Mahalle Çarşısı')).toBe('Mahalle Çarşısı');
  });

  it('keeps a name that is only the word', () => {
    expect(shortHoodName('Mahallesi')).toBe('Mahallesi');
    expect(shortHoodName('')).toBe('');
  });
});

describe('search.hoods', () => {
  it('lists the neighbourhoods of the installed provinces with their centre and a short name', async () => {
    const labels = await search.hoods();
    const rows = sql<{ name: string; cx: number | null; cy: number | null }>('SELECT name, cx, cy FROM neighbourhood WHERE cx IS NOT NULL AND cy IS NOT NULL ORDER BY id');
    expect(labels.length).toBe(rows.length);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.region).toBe('34');
      expect(label.name).not.toMatch(/\s(Mahallesi|Mahalesi|Mah\.?)$/i);
      expect(label.name.length).toBeGreaterThan(0);
    }
    const moda = labels.find((l) => l.name === 'Moda');
    const row = rows.find((r) => r.name.startsWith('Moda'));
    expect(moda?.lng).toBeCloseTo((row?.cx ?? 0) / 1e6, 6);
    expect(moda?.lat).toBeCloseTo((row?.cy ?? 0) / 1e6, 6);
  });

  it('can be limited to one province and is empty for one that is not installed', async () => {
    expect((await search.hoods('34')).length).toBe((await search.hoods()).length);
    expect(await search.hoods('06')).toEqual([]);
  });

  it('is sorted so the same packs always give the same list', async () => {
    const labels = await search.hoods();
    expect(labels).toEqual([...labels].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.lng - b.lng)));
  });
});

describe('search.coverage', () => {
  it('counts the streets and doors of the district the point is in', async () => {
    const streets = sql<{ n: number }>('SELECT COUNT(*) AS n FROM street_part WHERE district_id = (SELECT id FROM district WHERE name = \'Kadıköy\')')[0]?.n;
    const doors = sql<{ n: number }>('SELECT COUNT(*) AS n FROM address WHERE district_id = (SELECT id FROM district WHERE name = \'Kadıköy\')')[0]?.n;
    const result = await search.coverage([28.7, 41.0]);
    expect(result).toEqual({ region: '34', district: 'Kadıköy', streets, addresses: doors, level: 'sparse' });
  });

  it('names the other district for a point in it', async () => {
    expect((await search.coverage([29.1, 40.7]))?.district).toBe('Üsküdar');
  });

  it('is null where no installed pack applies or the point is not a point', async () => {
    expect(await search.coverage([35, 39])).toBeNull();
    expect(await search.coverage([28.0, 40.1])).toBeNull();
    for (const bad of [[Number.NaN, 40], [28, Infinity], [], null, undefined, 'x']) expect(await search.coverage(bad as never)).toBeNull();
  });
});
