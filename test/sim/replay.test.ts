import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearch } from '../../src/core/address/search';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { distanceM } from '../../src/core/geo/distance';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';
import { chooseHidden, hidePack, readDoors } from './hide';
import { rng } from './random';
import { confirmTarget, probe, simStore, targetsOf } from './replay';

let file = '';
let hiddenFile = '';
let hidden: ReturnType<typeof readDoors> = [];

beforeAll(async () => {
  file = await builtPack();
  const doors = readDoors(file);
  const bahariye = doors.filter((d) => d.num !== null && [4, 8, 12].includes(d.num) && d.parity === 0);
  hidden = bahariye;
  hiddenFile = join(mkdtempSync(join(tmpdir(), 'geo-replay-')), 'hidden.sqlite');
  hidePack(file, hiddenFile, new Set(hidden.map((d) => d.id)));
});

const open = async () => {
  const { store } = await memoryStore({ '34': hiddenFile });
  const learning = await createLearning({ store: learnStore(), now: () => 1_700_000_000, neighbours: 'all' });
  return { learning, search: createSearch({ store: simStore(store, '34', hiddenFile), borders: turkeyBorders(), layers: [learning.layer] }) };
};

describe('targetsOf', () => {
  it('describes each hidden door with its official names and its true point', () => {
    const targets = targetsOf(hiddenFile, '34', hidden, 10, rng(1));
    expect(targets).toHaveLength(hidden.length);
    const t = targets.find((x) => x.door.num === 8) as (typeof targets)[number];
    expect(t).toMatchObject({ plate: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi' });
    expect(t.query).toEqual({ province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '8' });
    expect(t.truth).toEqual([t.door.lng, t.door.lat]);
  });

  it('keeps at most the asked number, repeatably', () => {
    const a = targetsOf(hiddenFile, '34', hidden, 2, rng(3));
    expect(a).toHaveLength(2);
    expect(targetsOf(hiddenFile, '34', hidden, 2, rng(3)).map((x) => x.door.id)).toEqual(a.map((x) => x.door.id));
    expect(targetsOf(hiddenFile, '34', hidden, 0, rng(3))).toEqual([]);
  });
});

describe('probe', () => {
  it('finds the predicted place of a hidden door and its distance from the truth', async () => {
    const { search } = await open();
    const target = targetsOf(hiddenFile, '34', hidden, 10, rng(1)).find((x) => x.door.num === 8) as ReturnType<typeof targetsOf>[number];
    const found = await probe(search, target);
    expect(found?.place).toMatchObject({ source: 'interpolated', approximate: true });
    expect(found?.errorM).toBeLessThan(5);
    expect(found?.errorM).toBeCloseTo(distanceM(target.truth, (found?.place.coordinate) as [number, number]), 6);
  });

  it('is null when nothing of that district and street comes back', async () => {
    const { search } = await open();
    const target = targetsOf(hiddenFile, '34', hidden, 10, rng(1))[0] as ReturnType<typeof targetsOf>[number];
    expect(await probe(search, { ...target, district: 'Beşiktaş' })).toBeNull();
    expect(await probe(search, { ...target, street: 'Olmayan Sokak' })).toBeNull();
  });
});

describe('confirmTarget', () => {
  it('makes the next probe land where the confirmations put it', async () => {
    const { search, learning } = await open();
    const target = targetsOf(hiddenFile, '34', hidden, 10, rng(1)).find((x) => x.door.num === 8) as ReturnType<typeof targetsOf>[number];
    const before = (await probe(search, target)) as NonNullable<Awaited<ReturnType<typeof probe>>>;
    const noise = rng(21);
    expect(await confirmTarget(learning, before.place, target, 'pin', noise, 1)).toBe(1);
    const after = (await probe(search, target)) as NonNullable<Awaited<ReturnType<typeof probe>>>;
    expect(after.place).toMatchObject({ source: 'learned', approximate: false, precision: 'address' });
    expect(after.errorM).toBeLessThan(20);
  });

  it('counts only the confirmations the learner accepted', async () => {
    const { search, learning } = await open();
    const target = targetsOf(hiddenFile, '34', hidden, 10, rng(1)).find((x) => x.door.num === 8) as ReturnType<typeof targetsOf>[number];
    const before = (await probe(search, target)) as NonNullable<Awaited<ReturnType<typeof probe>>>;
    expect(await confirmTarget(learning, before.place, target, 'delivery', rng(2), 3)).toBe(3);
    expect(await confirmTarget(learning, { ...before.place, components: {} }, target, 'delivery', rng(2), 3)).toBe(0);
    expect(await confirmTarget(learning, before.place, { ...target, door: { ...target.door, number: 'yok' } }, 'delivery', rng(2), 3)).toBe(0);
  });

  it('can leave outliers out of the deliveries', async () => {
    const { search, learning } = await open();
    const target = targetsOf(hiddenFile, '34', hidden, 10, rng(1)).find((x) => x.door.num === 8) as ReturnType<typeof targetsOf>[number];
    const before = (await probe(search, target)) as NonNullable<Awaited<ReturnType<typeof probe>>>;
    await confirmTarget(learning, before.place, target, 'delivery', rng(2), 40, { outliers: false });
    const after = (await probe(search, target)) as NonNullable<Awaited<ReturnType<typeof probe>>>;
    expect(after.errorM).toBeLessThan(10);
  });
});

describe('simStore', () => {
  it('serves the hidden file for the plate and the original store for the rest', async () => {
    const { store } = await memoryStore({ '34': file, '06': file });
    const sim = simStore(store, '34', hiddenFile);
    expect(await sim.installed()).toEqual(['34']);
    expect(await sim.open('06')).toBeNull();
    const db = await sim.open('34');
    expect((await db?.all<{ n: number }>('SELECT COUNT(*) AS n FROM address WHERE street_id IS NOT NULL'))?.[0]?.n).toBe(readDoors(hiddenFile).length);
    await db?.close();
    expect(chooseHidden(hidden, 0, rng(1)).size).toBe(0);
  });
});
