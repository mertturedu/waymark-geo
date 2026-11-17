import { createNeighbourhoods } from '../../src/core/address/neighbourhoods';
import { createSearch } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';
import { sampleSource } from './helpers/neighbourhood-fixture';

const borders = turkeyBorders();

async function rig(withDirectory: boolean) {
  const file = await builtPack();
  const { store, close } = await memoryStore({ '34': file });
  const search = createSearch({ store, borders, ...(withDirectory ? { neighbourhoods: createNeighbourhoods(sampleSource()) } : {}) });
  return { search, close };
}

describe('search with a neighbourhood directory', () => {
  it('works as before when no directory is given', async () => {
    const { search, close } = await rig(false);
    const result = await search.resolve('Zeytin Sokak 5 Moda Mahallesi Kadıköy');
    expect(result.status).toBe('resolved');
    const validation = await search.validate('Zeytin Sokak 5 Moda Mahallesi Kadıköy 34660');
    expect(validation.notes.map((n) => n.code)).not.toContain('postcode_mismatch');
    await close();
  });

  it('finds the province from a postcode alone', async () => {
    const { search, close } = await rig(true);
    const result = await search.resolve('Zeytin Sokak 5 34710');
    expect(result.status === 'resolved' || result.status === 'ambiguous').toBe(true);
    if (result.status === 'resolved' || result.status === 'ambiguous') expect(result.candidates[0]?.region).toBe('34');
    await close();
  });

  it('warns when the postcode does not belong to the typed neighbourhood', async () => {
    const { search, close } = await rig(true);
    const bad = await search.validate('Zeytin Sokak 5 Hasanpaşa Mahallesi Kadıköy 34660');
    const note = bad.notes.find((n) => n.code === 'postcode_mismatch');
    expect(note).toMatchObject({ severity: 'warning', field: 'postcode', fix: { field: 'postcode', value: '34710', options: ['34710'] } });
    expect(note?.message).toContain('34660');
    const good = await search.validate('Zeytin Sokak 5 Hasanpaşa Mahallesi Kadıköy 34710');
    expect(good.notes.map((n) => n.code)).not.toContain('postcode_mismatch');
    await close();
  });

  it('suggests a listed neighbourhood that the map data does not have', async () => {
    const { search, close } = await rig(true);
    const typo = await search.validate('Zeytin Sokak 5 Hasanpasaa Mahallesi Kadıköy');
    expect(typo.suggestions.neighbourhood).toBe('Hasanpaşa');
    const known = await search.validate('Zeytin Sokak 5 Moda Mahallesi Kadıköy');
    expect(known.suggestions.neighbourhood).toBeUndefined();
    await close();
  });

  it('adds the postcode to a neighbourhood result', async () => {
    const { search, close } = await rig(true);
    const result = await search.resolve('Moda Mahallesi Kadıköy');
    const place = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    expect(place?.components.neighbourhood).toBeDefined();
    expect(place?.components.postcode).toBe('34710');
    await close();
  });

  it('leaves a postcode that the map data already has untouched', async () => {
    const { search, close } = await rig(true);
    const result = await search.resolve('Zeytin Sokak 5 Moda Mahallesi Kadıköy');
    const place = result.status === 'resolved' ? result.best : undefined;
    expect(place?.components.postcode === undefined || place.components.postcode === '34710').toBe(true);
    await close();
  });
});
