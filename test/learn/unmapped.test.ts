import { createSearch, type Search } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import { createLearning, type Learning } from '../../src/core/learn';
import { memoryStore } from '../../src/core/learn/store';
import { builtPack, memoryStore as packStore, turkeyBorders } from '../address/helpers/search-fixture';

let pack = '';
let closePacks: () => Promise<void> = async () => undefined;

beforeAll(async () => {
  pack = await builtPack();
  const { close } = await packStore({ '34': pack });
  closePacks = close;
});

afterAll(async () => closePacks());

async function rig(): Promise<{ search: Search; learning: Learning; store: ReturnType<typeof memoryStore>; close: () => Promise<void> }> {
  const { store: packs, close } = await packStore({ '34': pack });
  const store = memoryStore();
  const learning = await createLearning({ store });
  return { search: createSearch({ store: packs, borders: turkeyBorders(), layers: [learning.layer] }), learning, store, close };
}

const QUERY = 'Kadıköy Moda Mah. Olmayan Sokak No:5';

async function areaPlace(search: Search, text = QUERY): Promise<Place> {
  const result = await search.resolve(text);
  if (result.status === 'region_missing') throw new Error('missing');
  const best = result.status === 'resolved' ? result.best : result.candidates[0];
  if (!best) throw new Error('nothing');
  return best;
}

describe('learning a door on a street the map does not have', () => {
  it('stores the street the person typed with the area answer', async () => {
    const { search, learning, store, close } = await rig();
    const place = await areaPlace(search);
    expect(place.precision).toBe('neighbourhood');
    const result = await learning.confirm({ place, street: 'Olmayan Sokak', houseNumber: '5', point: [28.6001, 40.7002], source: 'pin' });
    expect(result).toMatchObject({ ok: true, trusted: true });
    const rows = await store.readAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('34|kadikoy|moda|olmayan~sokak|5');
    expect(JSON.parse(rows[0]?.value ?? '{}').text).toContain('Olmayan Sokak');
    await close();
  });

  it('then answers the same typed address with that point', async () => {
    const { search, learning, close } = await rig();
    const place = await areaPlace(search);
    await learning.confirm({ place, street: 'Olmayan Sokak', houseNumber: '5', point: [28.6001, 40.7002], source: 'pin' });
    const result = await search.resolve(QUERY);
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.best).toMatchObject({ precision: 'address', approximate: false, source: 'learned', coordinate: [28.6001, 40.7002], components: { street: 'Olmayan Sokak', houseNumber: '5', neighbourhood: 'Moda', district: 'Kadıköy' } });
    expect(result.best.label).toContain('Olmayan Sokak No:5');
    const folded = await search.resolve('kadikoy moda mah olmayan sk no 5');
    expect(folded.status === 'resolved' && folded.best.coordinate).toEqual([28.6001, 40.7002]);
    await close();
  });

  it('keeps one delivery an estimate and never exact', async () => {
    const { search, learning, close } = await rig();
    const place = await areaPlace(search);
    await learning.confirm({ place, street: 'Olmayan Sokak', houseNumber: '5', point: [28.6001, 40.7002], source: 'delivery' });
    const result = await search.resolve(QUERY);
    expect(result.status === 'resolved' && result.best).toMatchObject({ precision: 'interpolated', approximate: true, source: 'learned' });
    await close();
  });

  it('does not answer another number, another street or another neighbourhood with it', async () => {
    const { search, learning, close } = await rig();
    const place = await areaPlace(search);
    await learning.confirm({ place, street: 'Olmayan Sokak', houseNumber: '5', point: [28.6001, 40.7002], source: 'pin' });
    for (const other of ['Kadıköy Moda Mah. Olmayan Sokak No:7', 'Kadıköy Moda Mah. Baska Sokak No:5', 'Kadıköy Fener Mah. Olmayan Sokak No:5']) {
      const result = await search.resolve(other);
      const first = result.status === 'resolved' ? result.best : result.status === 'region_missing' ? undefined : result.candidates[0];
      expect(first?.source).not.toBe('learned');
      expect(first?.precision).not.toBe('address');
    }
    await close();
  });

  it('needs a house number to build a key and falls back to a street-less door without a usable street', async () => {
    const { search, learning, store, close } = await rig();
    const place = await areaPlace(search);
    expect(await learning.confirm({ place, street: 'Olmayan Sokak', point: [28.6, 40.7], source: 'pin' })).toEqual({ ok: false, reason: 'no-key' });
    expect(await learning.confirm({ place, street: '   ', houseNumber: '5', point: [28.6, 40.7], source: 'pin' })).toMatchObject({ ok: true });
    expect((await store.readAll()).map((r) => r.key)).toEqual(['34|kadikoy|moda||5']);
    await close();
  });

  it('ignores the typed street when the place already has one, and refuses a street that is too long', async () => {
    const { search, learning, store, close } = await rig();
    const real = await areaPlace(search, 'Bahariye Caddesi 14 Kadıköy');
    expect(real.components.street).toBe('Bahariye Caddesi');
    await learning.confirm({ place: real, street: 'Baska Sokak', point: [28.6001, 40.7001], source: 'pin' });
    expect((await store.readAll())[0]?.key).toBe('34|kadikoy|moda|bahariye~cadde|14');
    const place = await areaPlace(search);
    expect(await learning.confirm({ place, street: 'x'.repeat(300), houseNumber: '5', point: [28.6, 40.7], source: 'pin' })).toEqual({ ok: false, reason: 'invalid-input' });
    expect(await learning.confirm({ place, street: 42 as never, houseNumber: '5', point: [28.6, 40.7], source: 'pin' })).toMatchObject({ ok: true });
    await close();
  });

  it('survives export and import into a fresh learner', async () => {
    const first = await rig();
    const place = await areaPlace(first.search);
    await first.learning.confirm({ place, street: 'Olmayan Sokak', houseNumber: '5', point: [28.6001, 40.7002], source: 'pin' });
    const lines = first.learning.exportLines();
    const second = await rig();
    expect(await second.learning.importLines(lines)).toMatchObject({ added: 1 });
    const result = await second.search.resolve(QUERY);
    expect(result.status === 'resolved' && result.best.source).toBe('learned');
    await first.close();
    await second.close();
  });
});
