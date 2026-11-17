import type { LayerKey, LayerScope, PointLayer } from '../address/types';
import type { PackStore } from '../ports';
import { openLearned, type LearnedPack } from './pack';

export type LearnedLayer = PointLayer & { pack(region: string): Promise<LearnedPack | null> };

export function createLearnedLayer(store: PackStore): LearnedLayer {
  const readers = new WeakMap<object, Promise<LearnedPack | null>>();
  const pack = async (region: string): Promise<LearnedPack | null> => {
    const db = store.openPart ? await store.openPart(region, 'learned') : null;
    if (!db) return null;
    let reader = readers.get(db);
    if (!reader) {
      reader = openLearned(db).catch(() => null);
      readers.set(db, reader);
    }
    return reader;
  };
  return {
    name: 'learned',
    pack,
    async lookup(key: LayerKey) {
      return (await pack(key.region))?.lookup(key) ?? null;
    },
    async nearby(scope: LayerScope) {
      return (await pack(scope.region))?.nearby(scope) ?? [];
    },
    async layout(region: string, key: string) {
      return (await pack(region))?.layout(key) ?? null;
    },
    async entrances(region: string, key: string) {
      const found = (await (await pack(region))?.entrances(key)) ?? [];
      return [...found].sort((a, b) => b.sources - a.sources).map((e) => e.point);
    },
    async hints(region: string, district: string) {
      return (await pack(region))?.hints(district) ?? [];
    },
  };
}
