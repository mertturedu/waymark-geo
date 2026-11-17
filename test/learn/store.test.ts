import { memoryStore } from '../../src/core/learn/store';

describe('memoryStore', () => {
  it('starts empty', async () => {
    expect(await memoryStore().readAll()).toEqual([]);
  });

  it('keeps what was written, replaces by key and lists in key order', async () => {
    const store = memoryStore();
    for (const key of ['c', 'a', 'd', 'b']) await store.write(key, key);
    await store.write('b', '3');
    expect(await store.readAll()).toEqual([{ key: 'a', value: 'a' }, { key: 'b', value: '3' }, { key: 'c', value: 'c' }, { key: 'd', value: 'd' }]);
    await store.write('a', 'a2');
    expect((await store.readAll()).map((r) => r.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes a key and ignores a key that is not there', async () => {
    const store = memoryStore();
    await store.write('a', '1');
    await store.remove('a');
    await store.remove('zzz');
    expect(await store.readAll()).toEqual([]);
  });

  it('hands out a copy, so reading cannot change the store', async () => {
    const store = memoryStore();
    await store.write('a', '1');
    (await store.readAll()).push({ key: 'x', value: 'y' });
    expect(await store.readAll()).toHaveLength(1);
    expect(store.snapshot().get('a')).toBe('1');
  });
});
