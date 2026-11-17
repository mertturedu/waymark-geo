import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Place } from '../../src/core/address/types';
import { correctionLines, createCorrections, reviewImport } from '../../src/core/learn/corrections';
import { composeKey, scopeOfKey, validKey } from '../../src/core/learn/key';
import { createLearning, type ConfirmInput } from '../../src/core/learn/learning';
import { mergeConfirmations } from '../../src/core/learn/merge';
import { memoryStore, type LearnStore } from '../../src/core/learn/store';
import { distanceM } from '../../src/core/geo/distance';

const components = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '20' };
const place = (extra: Partial<Place> = {}): Place => ({
  id: 'x', label: 'x', components, coordinate: [28.66, 40.76], precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.5, region: '34', ...extra,
});
const KEY = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };
const M = 111_195;
const east = (m: number): [number, number] => [28.66 + m / (M * Math.cos((40.76 * Math.PI) / 180)), 40.76];
const open = (store: LearnStore = memoryStore(), now = () => 1_700_000_000) => createLearning({ store, now, neighbours: 'all' });
const line = (confirmations: object[], key = composeKey(KEY), text = 'Gül Sokak No:20, Moda Mah., Kadıköy/İstanbul') => JSON.stringify({ v: 1, key, region: '34', text, confirmations });
const delivery = { source: 'delivery', lng: 29, lat: 41, at: 5 };

describe('H3 duplicate confirmations inside one imported line', () => {
  it('count once', async () => {
    const learning = await open();
    await learning.importLines([line([delivery, delivery])]);
    expect(learning.stats().confirmations).toBe(1);
    expect((await learning.layer.lookup(KEY))?.trusted).toBe(false);
  });
});

describe('H4 absurd accuracy values', () => {
  it('keep the merged point finite', () => {
    for (const accuracyM of [1e154, 1e200, Number.MAX_VALUE]) {
      const merged = mergeConfirmations([{ source: 'pin', lng: 29, lat: 41, at: 1, accuracyM }, { source: 'pin', lng: 29.0001, lat: 41, at: 2, accuracyM }]);
      expect(Number.isFinite(merged?.coordinate[0])).toBe(true);
      expect(Number.isFinite(merged?.coordinate[1])).toBe(true);
    }
  });

  it('never let the learner serve a NaN point', async () => {
    const learning = await open();
    await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin', accuracyM: 1e200 });
    await learning.confirm({ place: place(), point: [28.6601, 40.76], source: 'pin', accuracyM: 1e200 });
    const found = await learning.layer.lookup(KEY);
    expect(found?.coordinate.every(Number.isFinite)).toBe(true);
  });
});

describe('H7 text of imported lines', () => {
  it('is never taken from the file', async () => {
    const learning = await open();
    await learning.importLines([line([delivery], composeKey(KEY), 'Ayşe Demir 0555 000 00 00 sipariş 12345')]);
    const text = JSON.parse(learning.exportLines()[0] as string).text as string;
    expect(text).not.toContain('Ayşe');
    expect(text).not.toContain('0555');
    expect(text.length).toBeLessThan(200);
  });

  it('keeps the label a door already has', async () => {
    const learning = await open();
    await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    const before = JSON.parse(learning.exportLines()[0] as string).text;
    await learning.importLines([line([{ ...delivery, at: 9 }], composeKey(KEY), 'başka metin')]);
    expect(JSON.parse(learning.exportLines()[0] as string).text).toBe(before);
  });

  it('is rebuilt in the review too', () => {
    const review = reviewImport([[line([{ source: 'pin', lng: 29, lat: 41, at: 1 }], composeKey(KEY), 'Ayşe Demir 0555')]]);
    expect(review.accepted[0]?.text).not.toContain('Ayşe');
  });
});

describe('keys that do not look like keys', () => {
  const bad = ['34||||', '__proto__|a|b|c|1', '34|a|b|c', '34|a|b|c|d|e', '34||x||5', '34|a|||5', '34|a||c|', `34|${'a'.repeat(200)}||c|5`, 'ab|a|b|c|1'];

  it.each(bad)('%s is refused by validKey and by the import', async (key) => {
    expect(validKey(key, key.split('|')[0] as string)).toBe(false);
    const learning = await open();
    expect(await learning.importLines([JSON.stringify({ v: 1, key, region: key.split('|')[0], text: 't', confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1 }] })])).toEqual({ added: 0, merged: 0, skipped: 1 });
  });

  it('accepts a real key and refuses a region that does not match it', () => {
    expect(validKey(composeKey(KEY), '34')).toBe(true);
    expect(validKey(composeKey(KEY), '06')).toBe(false);
    expect(validKey(composeKey({ ...KEY, neighbourhood: '' }), '34')).toBe(true);
    expect(validKey(composeKey({ ...KEY, street: '' }), '34')).toBe(true);
  });

  it('is also refused by the correction layer when the region does not fit', async () => {
    const row = { v: 1, key: composeKey(KEY), region: '06', text: 't', lng: 29, lat: 41, count: 1 };
    expect(await createCorrections([JSON.stringify(row)]).lookup(KEY)).toBeNull();
    expect(await createCorrections([JSON.stringify({ ...row, region: '34', count: -5 })]).lookup(KEY)).toBeNull();
    expect(await createCorrections([JSON.stringify({ ...row, region: '34', count: 0 })]).lookup(KEY)).toBeNull();
    expect(await createCorrections([JSON.stringify({ ...row, region: '34', count: 1.5 })]).lookup(KEY)).toBeNull();
  });
});

describe('H6 neighbours are found without scanning every learned door', () => {
  it('answers many calls quickly with many learned doors elsewhere', async () => {
    const store = memoryStore();
    for (let i = 0; i < 20000; i++) {
      const key = composeKey({ ...KEY, street: `sokak${i}~sokak`, houseNumber: String((i % 90) + 1) });
      await store.write(key, JSON.stringify({ v: 1, key, region: '34', text: 't', confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1 }] }));
    }
    const learning = await open(store);
    const nearby = learning.layer.nearby as NonNullable<typeof learning.layer.nearby>;
    const start = Date.now();
    for (let i = 0; i < 300; i++) await nearby({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: `sokak${i}~sokak` });
    expect(Date.now() - start).toBeLessThan(400);
    expect((await nearby({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'sokak5~sokak' })).map((n) => n.int)).toEqual([6]);
  });

  it('follows a door that is added, forgotten and imported', async () => {
    const learning = await open();
    const nearby = learning.layer.nearby as NonNullable<typeof learning.layer.nearby>;
    const scope = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' };
    await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    expect((await nearby(scope)).map((n) => n.int)).toEqual([20]);
    await learning.importLines([line([{ source: 'pin', lng: 29, lat: 41, at: 1 }], composeKey({ ...KEY, houseNumber: '8' }))]);
    expect((await nearby(scope)).map((n) => n.int)).toEqual([8, 20]);
    await learning.forget(composeKey(KEY));
    expect((await nearby(scope)).map((n) => n.int)).toEqual([8]);
    await learning.forget();
    expect(await nearby(scope)).toEqual([]);
  });

  it('leaves out a number too long to be a number', () => {
    expect(scopeOfKey(composeKey({ ...KEY, houseNumber: '1234567890123' }))).toBeNull();
    expect(scopeOfKey(composeKey(KEY))).toEqual({ scope: '34|kadikoy|moda|gul~sokak', int: 20 });
  });
});

describe('H9 odd input to confirm', () => {
  const cases: [string, unknown][] = [
    ['street is a number', { place: place({ components: { ...components, street: 5 as unknown as string } }), point: [28.66, 40.76], source: 'pin' }],
    ['district is an object', { place: place({ components: { ...components, district: {} as unknown as string } }), point: [28.66, 40.76], source: 'pin' }],
    ['region is a number', { place: place({ region: 5 as unknown as string }), point: [28.66, 40.76], source: 'pin' }],
    ['a million letters in a street', { place: place({ components: { ...components, street: 'a'.repeat(1_000_000) } }), point: [28.66, 40.76], source: 'pin' }],
    ['a getter that throws', { get place(): Place { throw new Error('boom'); }, point: [28.66, 40.76], source: 'pin' }],
  ];

  it.each(cases)('%s', async (_name, input) => {
    const store = memoryStore();
    const learning = await open(store);
    const result = await learning.confirm(input as ConfirmInput);
    expect(result.ok).toBe(false);
    expect(store.snapshot().size).toBe(0);
    expect(await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' })).toMatchObject({ ok: true });
  });
});

describe('H10 a clock that goes backwards', () => {
  it('still keeps the newest confirmation', async () => {
    let now = 2_000_000_000;
    const learning = await open(memoryStore(), () => now);
    for (let i = 0; i < 20; i++) await learning.confirm({ place: place(), point: east(i * 0.001), source: 'delivery', accuracyM: 10 + i * 0.01 });
    now = 1_700_000_000;
    const result = await learning.confirm({ place: place(), point: east(0), source: 'pin' });
    expect(result).toMatchObject({ ok: true, trusted: true });
    expect(JSON.parse(learning.exportLines()[0] as string).confirmations.some((c: { source: string }) => c.source === 'pin')).toBe(true);
  });
});

describe('H11 rows read from the store', () => {
  it('lose points outside the country and keep at most twenty confirmations', async () => {
    const store = memoryStore();
    const key = composeKey(KEY);
    await store.write(key, JSON.stringify({ v: 1, key, region: '34', text: 't', confirmations: Array.from({ length: 50 }, (_, i) => ({ source: 'delivery', lng: 29, lat: 41, at: i })) }));
    const other = composeKey({ ...KEY, houseNumber: '22' });
    await store.write(other, JSON.stringify({ v: 1, key: other, region: '34', text: 't', confirmations: [{ source: 'pin', lng: 0, lat: 0, at: 1 }] }));
    const learning = await open(store);
    expect(JSON.parse(learning.exportLines()[0] as string).confirmations).toHaveLength(20);
    expect(await learning.layer.lookup({ ...KEY, houseNumber: '22' })).toBeNull();
    expect(learning.stats()).toMatchObject({ keys: 1, damaged: 1 });
  });
});

describe('H12 odd arguments to importLines', () => {
  it('do not throw and do not leave a half import behind', async () => {
    const learning = await open();
    for (const bad of [null, undefined, 5, {}, 'text'] as unknown as string[][]) expect(await learning.importLines(bad)).toEqual({ added: 0, merged: 0, skipped: 0 });
    const result = await learning.importLines([line([delivery]), null, 5, {}] as unknown as string[]);
    expect(result).toEqual({ added: 1, merged: 0, skipped: 3 });
  });
});

describe('H13 backups of unreadable rows', () => {
  it('keep the first copy when the row breaks again', async () => {
    const store = memoryStore();
    const key = composeKey(KEY);
    await store.write(key, '{broken1');
    const first = await open(store);
    await first.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    await store.write(key, '{broken2');
    const second = await open(store);
    await second.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    const backups = [...store.snapshot()].filter(([k]) => k.startsWith('~old:')).map(([, v]) => v).sort();
    expect(backups).toEqual(['{broken1', '{broken2']);
  });
});

describe('H18 the same confirmation sent twice', () => {
  it('counts once', async () => {
    const learning = await open();
    expect(await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'delivery', accuracyM: 8 })).toEqual({ ok: true, trusted: false, count: 1 });
    expect(await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'delivery', accuracyM: 8 })).toEqual({ ok: true, trusted: false, count: 1 });
    expect(learning.stats().confirmations).toBe(1);
  });
});

describe('H19 forget', () => {
  it('removes the backup of a door too', async () => {
    const store = memoryStore();
    const key = composeKey(KEY);
    await store.write(key, '{broken');
    const learning = await open(store);
    await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    expect([...store.snapshot().keys()].some((k) => k.startsWith('~old:'))).toBe(true);
    await learning.forget(key);
    expect([...store.snapshot().keys()]).toEqual([]);
  });

  it('keeps memory and store alike when a removal fails halfway', async () => {
    const inner = memoryStore();
    let failing = false;
    const store: LearnStore = { readAll: () => inner.readAll(), write: (k, v) => inner.write(k, v), remove: async (k) => { if (failing && k.endsWith('|22')) throw new Error('x'); await inner.remove(k); } };
    const learning = await open(store);
    for (const n of ['20', '22', '24']) await learning.confirm({ place: place({ components: { ...components, houseNumber: n } }), point: [28.66, 40.76], source: 'pin' });
    failing = true;
    await expect(learning.forget()).rejects.toThrow('x');
    failing = false;
    expect(learning.stats().keys).toBe(1);
    expect([...inner.snapshot().keys()].filter((k) => !k.startsWith('~old:'))).toEqual([composeKey({ ...KEY, houseNumber: '22' })]);
    await learning.forget();
    expect(learning.stats().keys).toBe(0);
  });

  it('keeps working after a job failed', async () => {
    const inner = memoryStore();
    let fail = true;
    const store: LearnStore = { readAll: () => inner.readAll(), write: (k, v) => inner.write(k, v), remove: async (k) => { if (fail) throw new Error('x'); await inner.remove(k); } };
    const learning = await open(store);
    await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' });
    await expect(learning.forget(composeKey(KEY))).rejects.toThrow('x');
    fail = false;
    expect(await learning.confirm({ place: place(), point: [28.66, 40.76], source: 'pin' })).toMatchObject({ ok: true });
  });
});

describe('weights and limits that must stay', () => {
  const at = (m: number, extra: object) => ({ source: 'delivery' as const, lng: east(m)[0], lat: 40.76, at: 1, accuracyM: 10, ...extra });

  it('weighs a pin four times a delivery and a manual point three times', () => {
    const pin = mergeConfirmations([at(0, { source: 'pin' }), at(40, {})]);
    expect(Math.abs(distanceM(pin?.coordinate as [number, number], east(0)) - 8)).toBeLessThan(0.2);
    const manual = mergeConfirmations([at(0, { source: 'manual' }), at(40, {})]);
    expect(Math.abs(distanceM(manual?.coordinate as [number, number], east(0)) - 10)).toBeLessThan(0.2);
  });

  it('treats an accuracy under five metres as five', () => {
    const merged = mergeConfirmations([at(0, { accuracyM: 1 }), at(20, { accuracyM: 5 })]);
    expect(Math.abs(distanceM(merged?.coordinate as [number, number], east(10)))).toBeLessThan(0.1);
  });

  it('refuses a point west of the box', async () => {
    const learning = await open();
    expect(await learning.confirm({ place: place(), point: [25.4, 40.76], source: 'pin' })).toEqual({ ok: false, reason: 'invalid-point' });
  });

  it('keeps unreadable rows out of the way of a forgotten key', async () => {
    const store = memoryStore();
    await store.write('a|b|c|d|1', '{broken');
    const learning = await open(store);
    expect(learning.stats().damaged).toBe(1);
    await learning.forget('a|b|c|d|1');
    expect(learning.stats().damaged).toBe(0);
  });
});

describe('the corrections import', () => {
  it('keeps an untrusted multi confirmation door out even when singles are asked for', () => {
    const far = [{ source: 'delivery', lng: east(0)[0], lat: 40.76, at: 1 }, { source: 'delivery', lng: east(150)[0], lat: 40.76, at: 2 }];
    expect(reviewImport([[line(far)]], { includeSingle: true }).accepted).toEqual([]);
  });

  it('writes lines with a single entry per key', () => {
    const lines = correctionLines([{ v: 1, key: composeKey(KEY), region: '34', text: 't', lng: 29, lat: 41, count: 1 }]);
    expect(lines).toHaveLength(1);
  });

  it('serves each key once to the neighbour search even if the file repeats it', async () => {
    const row = (lng: number) => JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', lng, lat: 41, count: 1 });
    const layer = createCorrections([row(29), row(29.1), row(29.2)]);
    const list = await (layer.nearby as NonNullable<typeof layer.nearby>)({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' });
    expect(list).toEqual([{ int: 20, coordinate: [29.2, 41], trusted: true }]);
  });
});

describe('a file store that cannot be read', () => {
  it('is left as it is (permission)', async () => {
    const { fileStore } = await import('../../src/node/learn-store');
    const dir = mkdtempSync(join(tmpdir(), 'geo-robust-'));
    const path = join(dir, 'learn.json');
    writeFileSync(path, JSON.stringify({ rows: { k1: 'v1' } }));
    chmodSync(path, 0o000);
    const store = fileStore(path);
    try {
      if (process.getuid && process.getuid() === 0) return;
      await expect(store.readAll()).rejects.toThrow();
      await expect(store.write('new', 'x')).rejects.toThrow();
    } finally {
      chmodSync(path, 0o600);
    }
    expect(await fileStore(path).readAll()).toEqual([{ key: 'k1', value: 'v1' }]);
  });
});
