import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare, writeBuildingPack, type Trace } from '../../pipeline/build/building-pack-v2';
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

  it('opens the buildings2 part once it is installed, and it is null until then', async () => {
    const { world } = await packWorld();
    const file = join(mkdtempSync(join(tmpdir(), 'b2-')), 'buildings2.sqlite');
    const trace: Trace = { id: 'w1', lon: 28.6, lat: 40.7, area: 120, ring: [[28.5999, 40.6999], [28.6001, 40.6999], [28.6001, 40.7001], [28.5999, 40.7001]], height: null, floors: 4, name: null, cls: null, src: null, rec: null };
    writeBuildingPack(file, '34', prepare([trace], [], new Map()), new Map(), 't');
    world.setPart('34', 'buildings2', new Uint8Array(readFileSync(file)));
    world.publish();
    const { manager } = await setup(world);
    await manager.checkUpdates();
    await manager.download('34', { parts: ['address'] });
    const store = createManagedPackStore({ manager, opener: nodeOpener(world), clock: world.env.clock });
    expect(await store.openPart?.('34', 'buildings2')).toBeNull();
    await manager.download('34', { parts: ['address', 'buildings2'] });
    const part = await store.openPart?.('34', 'buildings2');
    expect(await part?.all('SELECT v FROM meta WHERE k = ?', ['format'])).toEqual([{ v: '2' }]);
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

  it('lets go of a province on request, keeps it readable for the grace time, and opens it again when asked', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const clock = manualClock();
    let opens = 0;
    const opener = nodeOpener(world);
    const store = createManagedPackStore({ manager, opener: async (path) => (opens += 1, opener(path)), clock, graceMs: 5_000 });
    const first = await store.open('34');
    expect(await store.open('34')).toBe(first);
    expect(opens).toBe(1);
    store.release?.('34');
    expect(await first?.all('SELECT v FROM meta WHERE k = ?', ['format'])).toHaveLength(1);
    const second = await store.open('34');
    expect(second).not.toBe(first);
    expect(opens).toBe(2);
    expect(clock.sleeps).toEqual([5_000]);
    clock.release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(first?.all('SELECT 1')).rejects.toThrow(/closed/);
    expect(await second?.all('SELECT v FROM meta WHERE k = ?', ['format'])).toHaveLength(1);
    await store.closeAll();
  });

  it('runs a short question on its own connection and closes it, or reuses the open one', async () => {
    const { world } = await packWorld();
    const { manager } = await setup(world);
    await manager.download('34', { parts: ['address'] });
    const opener = nodeOpener(world);
    const made: { close: () => Promise<void> }[] = [];
    let closed = 0;
    const store = createManagedPackStore({
      manager,
      opener: async (path) => {
        const db = await opener(path);
        const wrapped = { all: db.all.bind(db), close: async () => (closed += 1, db.close()) };
        made.push(wrapped);
        return wrapped;
      },
      clock: world.env.clock,
    });
    expect(await store.peek?.('34', async (db) => (await db.all<{ v: string }>('SELECT v FROM meta WHERE k = ?', ['format']))[0]?.v)).toBeTruthy();
    expect(made).toHaveLength(1);
    expect(closed).toBe(1);
    expect(await store.peek?.('99', async () => 1)).toBeNull();
    await store.open('34');
    expect(made).toHaveLength(2);
    expect(await store.peek?.('34', async () => 'shared')).toBe('shared');
    expect(made).toHaveLength(2);
    expect(closed).toBe(1);
    await store.closeAll();
  });
});

