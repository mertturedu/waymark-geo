import { prefixScore } from '../../src/core/address/autocomplete';
import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

const seen = async (text: string, hints?: { district?: string }) => (await search.autocomplete(text, hints ? { hints } : undefined)).map((p) => `${p.id}:${p.precision}:${p.confidence}`);

describe('prefixScore', () => {
  it('is one for the whole name and grows with the typed share otherwise', () => {
    expect(prefixScore('bahariye', 'bahariye')).toBe(1);
    expect(prefixScore('bah', 'bahariye')).toBeCloseTo(0.6 + 0.35 * (3 / 8), 10);
    expect(prefixScore('bahariyex', 'bahariye')).toBeCloseTo(0.95, 10);
    expect(prefixScore('ba', 'baba')).toBeLessThan(prefixScore('bab', 'baba'));
  });
});

describe('autocomplete scores and order', () => {
  it('starts answering at two letters and not before', async () => {
    expect(await seen('ba')).toEqual(['34:s:5:1:street:0.688', '34:h:3:neighbourhood:0.619']);
    expect(await seen('b')).toEqual([]);
  });

  it('scores a street by how much of its name was typed', async () => {
    expect(await seen('bah')).toEqual(['34:s:5:1:street:0.731', '34:h:3:neighbourhood:0.658']);
    expect(await seen('bahar')).toEqual(['34:s:5:1:street:0.819', '34:h:3:neighbourhood:0.737']);
    expect(await seen('bahariye caddesi')).toEqual(['34:s:5:1:street:1']);
  });

  it('keeps ties in id order', async () => {
    expect(await seen('atat')).toEqual(['34:s:3:1:street:0.8', '34:s:3:3:street:0.8', '34:s:4:1:street:0.8']);
  });

  it('scores neighbourhoods and districts below a whole name', async () => {
    expect(await seen('mod')).toEqual(['34:h:1:neighbourhood:0.776']);
    expect(await seen('moda')).toEqual(['34:h:1:neighbourhood:0.9']);
    expect(await seen('kadik')).toEqual(['34:d:1:district:0.808', '34:o:6:poi:0.628']);
    expect(await seen('üs')).toEqual(['34:d:2:district:0.665']);
  });

  it('does not list districts again once a district was typed', async () => {
    expect(await seen('kadikoy mod')).toEqual(['34:h:1:neighbourhood:0.776']);
    expect(await seen('kadikoy')).toEqual([]);
  });

  it('keeps places of the hinted district first and lowers the others', async () => {
    expect(await seen('kadikoy merkez')).toEqual(['34:o:3:poi:0.666', '34:o:5:poi:0.366']);
    expect(await seen('uskudar merkez')).toEqual(['34:o:5:poi:0.666', '34:o:3:poi:0.366']);
    expect(await seen('mer')).toEqual(['34:o:3:poi:0.603', '34:o:5:poi:0.603']);
  });

  it('lowers streets of other districts to the same factor and keeps the better ones first', async () => {
    expect(await seen('gul')).toEqual(['34:s:6:1:street:1', '34:s:6:2:street:1', '34:o:4:poi:0.619']);
    expect(await seen('gul', { district: 'Üsküdar' })).toEqual(['34:s:6:2:street:1', '34:o:4:poi:0.619', '34:s:6:1:street:0.55']);
  });

  it('gives a door instead of a street when a number follows', async () => {
    expect(await seen('bahariye 14')).toEqual(['34:a:17:address:1']);
  });

  it('answers places with the typed share too', async () => {
    expect(await seen('devlet')).toEqual(['34:o:1:poi:0.658']);
    expect(await seen('devlet h')).toEqual(['34:o:1:poi:0.697']);
    expect(await seen('kadikoy devlet')).toEqual(['34:o:1:poi:0.658']);
  });
});
