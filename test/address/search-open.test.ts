import type { PackStore, SqlDb } from '../../src/core/ports';
import { createSearch } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

const hint = { hints: { city: 'İstanbul' } };
const broken: SqlDb = { all: async () => { throw new Error('no such table: meta'); }, close: async () => undefined };
const wrongPart: SqlDb = { all: async (sql) => (sql.includes('FROM meta') ? [{ k: 'format', v: '9' }] : []) as never, close: async () => undefined };

describe('opening a pack that fails', () => {
  it('asks the store again after a failure and reports the province as missing meanwhile', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    let calls = 0;
    const flaky: PackStore = { installed: store.installed, open: async (id) => (++calls === 1 ? Promise.reject(new Error('disk')) : store.open(id)) };
    const search = createSearch({ store: flaky, borders: turkeyBorders() });
    const first = await search.resolve('bahariye caddesi 14', hint);
    expect(first).toMatchObject({ status: 'not_found', missing: ['34'] });
    const second = await search.resolve('bahariye caddesi 14', hint);
    expect(second).toMatchObject({ status: 'resolved', best: { components: { street: 'Bahariye Caddesi', houseNumber: '14' } } });
    expect('missing' in second).toBe(false);
    expect(calls).toBe(2);
    await close();
  });

  it('asks again after the store had nothing yet', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    let calls = 0;
    const late: PackStore = { installed: store.installed, open: async (id) => (++calls === 1 ? null : store.open(id)) };
    const search = createSearch({ store: late, borders: turkeyBorders() });
    expect((await search.resolve('bahariye caddesi 14', hint)).status).toBe('not_found');
    expect((await search.resolve('bahariye caddesi 14', hint)).status).toBe('resolved');
    await close();
  });

  it('keeps answering from the address pack when the building part is unreadable', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store: { ...store, openPart: async () => wrongPart }, borders: turkeyBorders() });
    expect(await search.resolve('bahariye caddesi 14', hint)).toMatchObject({ status: 'resolved' });
    expect(await search.reverse([28.59995, 40.7])).toMatchObject({ precision: 'address' });
    await close();
  });

  it('skips a damaged pack and still answers from the others, naming the damaged one', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const mixed: PackStore = { installed: async () => ['06', '34'], open: async (id) => (id === '06' ? broken : store.open(id)) };
    const search = createSearch({ store: mixed, borders: turkeyBorders() });
    const result = await search.resolve('bahariye caddesi 14');
    expect(result).toMatchObject({ status: 'resolved', missing: ['06'], best: { components: { street: 'Bahariye Caddesi' } } });
    expect(await search.autocomplete('bahar')).not.toEqual([]);
    expect(await search.reverse([28.59995, 40.7])).toMatchObject({ precision: 'address' });
    await close();
  });
});

describe('more packs installed than are searched at once', () => {
  it('names the provinces it left out when nothing says where to look', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const plates = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '34', '35'];
    const many: PackStore = { installed: async () => plates, open: async (id) => (id === '34' ? store.open(id) : null) };
    const search = createSearch({ store: many, borders: turkeyBorders() });
    const lost = await search.resolve('bahariye caddesi 14');
    expect(lost).toMatchObject({ status: 'not_found', missing: expect.arrayContaining(['34', '35']) });
    expect(await search.resolve('bahariye caddesi 14', hint)).toMatchObject({ status: 'resolved' });
    expect(await search.resolve('bahariye caddesi 14', { near: [28.6, 40.7] })).toMatchObject({ status: 'resolved' });
    await close();
  });
});

describe('input that is not what the types say', () => {
  it('answers nothing instead of throwing', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const bad = (v: unknown) => v as never;
    expect((await search.resolve(bad(null), hint)).status).toBe('not_found');
    expect((await search.resolve(bad(undefined), hint)).status).toBe('not_found');
    expect((await search.resolve(bad(42), hint)).status).toBe('not_found');
    expect((await search.resolve('bahariye caddesi 14', bad(null))).status).toBe('resolved');
    expect((await search.resolve('bahariye caddesi 14', bad({ hints: { city: 5 } }))).status).toBe('resolved');
    expect(await search.autocomplete(bad(null))).toEqual([]);
    expect(await search.autocomplete(bad(undefined), bad(null))).toEqual([]);
    expect(await search.reverse(bad(undefined))).toBeNull();
    expect(await search.reverse(bad(null))).toBeNull();
    expect(await search.reverse(bad([1]))).toBeNull();
    expect(await search.reverse(bad(['a', 'b']))).toBeNull();
    await close();
  });
});

describe('invalidate', () => {
  it('drops the opened pack of one province so the next question reads the store again', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    let opens = 0;
    const counting: PackStore = { installed: store.installed, open: async (id) => (opens += 1, store.open(id)) };
    const search = createSearch({ store: counting, borders: turkeyBorders() });
    await search.resolve('bahariye caddesi 14', hint);
    await search.resolve('bahariye caddesi 14', hint);
    expect(opens).toBe(1);
    search.invalidate('34');
    await search.resolve('bahariye caddesi 14', hint);
    expect(opens).toBe(2);
    await close();
  });

  it('drops every opened pack without an argument and ignores unknown provinces', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    let opens = 0;
    const counting: PackStore = { installed: store.installed, open: async (id) => (opens += 1, store.open(id)) };
    const search = createSearch({ store: counting, borders: turkeyBorders() });
    await search.resolve('bahariye caddesi 14', hint);
    search.invalidate('06');
    await search.resolve('bahariye caddesi 14', hint);
    expect(opens).toBe(1);
    search.invalidate();
    await search.resolve('bahariye caddesi 14', hint);
    expect(opens).toBe(2);
    await close();
  });

  it('lets a question that is already running finish on the pack it started with', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const running = search.resolve('bahariye caddesi 14', hint);
    search.invalidate('34');
    expect(await running).toMatchObject({ status: 'resolved' });
    await close();
  });
});
