import { createManagedRouteStore } from '../../src/core/packs/route-store';

type Fake = {
  installed: Map<string, string>;
  listeners: Set<() => void>;
  files: Map<string, Uint8Array>;
};

function setup(): { fake: Fake; store: ReturnType<typeof createManagedRouteStore>; reads: string[] } {
  const fake: Fake = { installed: new Map([['34', '/data/34/route.bin'], ['06', '/data/06/route.bin']]), listeners: new Set(), files: new Map([['/data/34/route.bin', Uint8Array.from([1, 2, 3])], ['/data/06/route.bin', Uint8Array.from([4])]]) };
  const reads: string[] = [];
  const manager = {
    installedRegions: () => ['06', '34', '35'],
    installedFile: (id: string, kind: string) => (kind === 'route' ? fake.installed.get(id) ?? null : null),
    subscribe: (listener: () => void) => {
      fake.listeners.add(listener);
      return () => void fake.listeners.delete(listener);
    },
  };
  const fs = {
    size: async (path: string) => fake.files.get(path)?.length ?? null,
    read: async (path: string, offset: number, length: number) => {
      reads.push(path);
      const bytes = fake.files.get(path);
      if (!bytes) throw new Error('yok');
      return bytes.slice(offset, offset + length);
    },
  };
  return { fake, reads, store: createManagedRouteStore({ manager, fs }) };
}

describe('createManagedRouteStore', () => {
  it('lists only the provinces that have a route part and reads the whole file', async () => {
    const { store } = setup();
    expect(await store.installed()).toEqual(['06', '34']);
    expect(Array.from((await store.read('34')) as Uint8Array)).toEqual([1, 2, 3]);
    expect(await store.read('35')).toBeNull();
  });

  it('returns null for a file that cannot be read instead of throwing', async () => {
    const { store, fake } = setup();
    fake.files.delete('/data/34/route.bin');
    expect(await store.read('34')).toBeNull();
  });

  it('tells listeners which province changed when its route file changes', async () => {
    const { store, fake } = setup();
    const seen: string[] = [];
    const stop = store.onChange((region) => seen.push(region));
    fake.listeners.forEach((l) => l());
    expect(seen).toEqual([]);
    fake.installed.set('34', '/data/34/route-2.bin');
    fake.files.set('/data/34/route-2.bin', Uint8Array.from([9]));
    fake.listeners.forEach((l) => l());
    expect(seen).toEqual(['34']);
    fake.installed.delete('06');
    fake.listeners.forEach((l) => l());
    expect(seen).toEqual(['34', '06']);
    stop();
    fake.installed.set('34', '/data/34/route-3.bin');
    fake.listeners.forEach((l) => l());
    expect(seen).toEqual(['34', '06']);
  });
});
