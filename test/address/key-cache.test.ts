import { cachedStreetKey, KEY_CACHE_MAX } from '../../src/core/address/key-cache';
import { streetKey } from '../../src/core/text/street';

describe('cachedStreetKey', () => {
  it('gives what streetKey gives and the very same object the second time', () => {
    const a = cachedStreetKey('bahariye caddesi');
    expect(a).toEqual(streetKey('bahariye caddesi'));
    expect(cachedStreetKey('bahariye caddesi')).toBe(a);
  });

  it('keeps giving the right answer after it was filled past its limit', () => {
    for (let i = 0; i < KEY_CACHE_MAX + 50; i++) cachedStreetKey(`sokak ${i}`);
    expect(cachedStreetKey('1707. sokak')).toEqual(streetKey('1707. sokak'));
    expect(cachedStreetKey('sokak 3')).toEqual(streetKey('sokak 3'));
  });
});

describe('cachedStreetKey limit', () => {
  type Cache = typeof import('../../src/core/address/key-cache');
  const fresh = async (): Promise<Cache> => {
    let mod!: Cache;
    await jest.isolateModulesAsync(async () => {
      mod = await import('../../src/core/address/key-cache');
    });
    return mod;
  };

  it('keeps every entry until it is exactly full', async () => {
    const { cachedStreetKey: get, KEY_CACHE_MAX: max } = await fresh();
    const first = get('sokak 0');
    for (let i = 1; i < max; i++) get(`sokak ${i}`);
    expect(get('sokak 0')).toBe(first);
  });

  it('starts over with the next new name once it is full', async () => {
    const { cachedStreetKey: get, KEY_CACHE_MAX: max } = await fresh();
    const first = get('sokak 0');
    for (let i = 1; i <= max; i++) get(`sokak ${i}`);
    const again = get('sokak 0');
    expect(again).not.toBe(first);
    expect(again).toEqual(first);
  });
});
