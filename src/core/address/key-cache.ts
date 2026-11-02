import { streetKey, type StreetKey } from '../text/street';

export const KEY_CACHE_MAX = 40_000;

let cache = new Map<string, StreetKey>();

export function cachedStreetKey(name: string): StreetKey {
  let key = cache.get(name);
  if (!key) {
    if (cache.size >= KEY_CACHE_MAX) cache = new Map();
    key = streetKey(name);
    cache.set(name, key);
  }
  return key;
}
