import { createSearch } from '../../src/core/address/search';
import { createManagedPackStore } from '../../src/core/packs/store';
import { turkeyBorders } from '../address/helpers/search-fixture';
import { manualClock, nodeOpener } from '../helpers/node-opener';
import { packWorld } from '../helpers/real-world';
import { requested, setup } from '../helpers/pack-setup';

const hint = { hints: { city: 'İstanbul' } };
describe('managed pack store', () => {
  it('has no regions before anything is installed, and search says which province to fetch', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.checkUpdates();
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    expect(await store.installed()).toEqual([]);
    expect(await store.open('34')).toBeNull();
    const search = createSearch({ store, borders: turkeyBorders() });
    expect(await search.resolve('bahariye caddesi 14', hint)).toEqual({ status: 'region_missing', regions: ['34'] });
    await store.closeAll();
  });

  it('answers after only the address part of that province is installed and fetches nothing else', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.checkUpdates();
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    const search = createSearch({ store, borders: turkeyBorders() });
    expect((await search.resolve('bahariye caddesi 14', hint)).status).toBe('region_missing');
    await manager.download('34', { parts: ['address'] });
    expect(await search.resolve('bahariye caddesi 14', hint)).toMatchObject({ status: 'resolved', best: { components: { street: 'Bahariye Caddesi', houseNumber: '14' } } });
    expect(requested(world).filter((p) => !p.startsWith('manifest'))).toEqual([world.pathOf('34', 'address')]);
    expect(await store.installed()).toEqual(['34']);
    expect(await store.openPart?.('34', 'buildings')).toBeNull();
    await store.closeAll();
  });

  it('opens the building part once it is installed', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address', 'buildings'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    const part = await store.openPart?.('34', 'buildings');
    expect(await part?.all('SELECT v FROM meta WHERE k = ?', ['format'])).toEqual([{ v: '1' }]);
    await store.closeAll();
  });

  it('reads the new pack after an update while a question that started earlier still finishes', async () => {
    const { world, v2 } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const clock = manualClock();
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock, graceMs: 5_000 });
    const search = createSearch({ store, borders: turkeyBorders() });
    store.onChange((plate) => search.invalidate(plate));
    expect((await search.resolve('yeni sokak 9', hint)).status).not.toBe('resolved');
    const running = search.resolve('bahariye caddesi 14', hint);
    world.setPart('34', 'address', v2);
    world.publish();
    await manager.checkUpdates();
    await manager.download('34');
    expect(await running).toMatchObject({ status: 'resolved' });
    expect(await search.resolve('yeni sokak 9', hint)).toMatchObject({ status: 'resolved', best: { components: { street: 'Yeni Sokak', houseNumber: '9' } } });
    expect(clock.sleeps).toEqual([5_000]);
    clock.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await search.resolve('bahariye caddesi 14', hint)).toMatchObject({ status: 'resolved' });
    await store.closeAll();
  });

  it('stops answering for a province that was removed', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    const search = createSearch({ store, borders: turkeyBorders() });
    store.onChange((plate) => search.invalidate(plate));
    expect((await search.resolve('bahariye caddesi 14', hint)).status).toBe('resolved');
    await manager.remove('34');
    expect(await store.installed()).toEqual([]);
    expect(await search.resolve('bahariye caddesi 14', hint)).toEqual({ status: 'region_missing', regions: ['34'] });
    await store.closeAll();
  });

  it('leaves a damaged pack out of the installed list instead of failing', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('06', { parts: ['address'] });
    await manager.download('34', { parts: ['address'] });
    const opener = nodeOpener(world);
    const store = createManagedPackStore({
      manager,
      opener: async (path) => {
        if (path.includes('/06/')) throw new Error('not a database');
        return opener(path);
      },
      clock: world.env.clock,
    });
    expect(await store.installed()).toEqual(['06', '34']);
    expect(await store.open('06')).toBeNull();
    expect(await store.installed()).toEqual(['34']);
    expect(await store.open('34')).not.toBeNull();
    await store.closeAll();
  });

  it('tries a damaged pack again when it is replaced', async () => {
    const { world, v2 } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const opener = nodeOpener(world);
    let healthy = false;
    const store = createManagedPackStore({ manager, opener: async (path) => (healthy ? opener(path) : Promise.reject(new Error('bad'))), clock: world.env.clock });
    expect(await store.open('34')).toBeNull();
    expect(await store.installed()).toEqual([]);
    healthy = true;
    world.setPart('34', 'address', v2);
    world.publish();
    await manager.checkUpdates();
    await manager.download('34');
    expect(await store.installed()).toEqual(['34']);
    expect(await store.open('34')).not.toBeNull();
    await store.closeAll();
  });

  it('tells listeners about provinces whose files changed, and only those', async () => {
    const { world, v2 } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    await store.open('34');
    const heard: string[] = [];
    const off = store.onChange((plate) => heard.push(plate));
    await manager.download('06', { parts: ['address'] });
    expect(heard).toEqual([]);
    world.setPart('34', 'address', v2);
    world.publish();
    await manager.checkUpdates();
    await manager.download('34');
    expect(heard).toEqual(['34']);
    await store.open('34');
    await manager.remove('34');
    expect(heard).toEqual(['34', '34']);
    off();
    await manager.download('34', { parts: ['address'] });
    await store.open('34');
    await manager.remove('34');
    expect(heard).toEqual(['34', '34']);
    await store.closeAll();
  });

  it('shares one open database between callers and closes everything on closeAll', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    const [first, second] = await Promise.all([store.open('34'), store.open('34')]);
    expect(first).toBe(second);
    await store.closeAll();
    await expect(first?.all('SELECT 1')).rejects.toThrow();
  });
});
