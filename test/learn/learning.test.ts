import { formatLabel } from '../../src/core/address/label';
import type { Place } from '../../src/core/address/types';
import { createLearning, type ConfirmInput } from '../../src/core/learn/learning';
import { memoryStore, type LearnStore } from '../../src/core/learn/store';
import { composeKey } from '../../src/core/learn/key';
import { nameKey } from '../../src/core/text/fold';
import { distanceM } from '../../src/core/geo/distance';

const components = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi', houseNumber: '40' };
const place = (extra: Partial<Place> = {}): Place => ({
  id: '34:a:1', label: 'Moda Caddesi No:40, Caferağa Mah., Kadıköy/İstanbul', components, coordinate: [29.025, 40.985], precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.8, region: '34', ...extra,
});
const KEY = { region: '34', district: nameKey('Kadıköy'), neighbourhood: nameKey('Caferağa'), street: 'moda~cadde', houseNumber: '40' };
const CLOCK = (): number => 1_700_000_000;
const input = (extra: Partial<ConfirmInput> = {}): ConfirmInput => ({ place: place(), point: [29.026, 40.986], source: 'pin', ...extra });

const open = (store: LearnStore = memoryStore()) => createLearning({ store, now: CLOCK });

describe('createLearning confirm and lookup', () => {
  it('answers a lookup with the confirmed point and its trust', async () => {
    const learning = await open();
    expect(await learning.confirm(input())).toEqual({ ok: true, trusted: true, count: 1 });
    expect(await learning.layer.lookup(KEY)).toEqual({ coordinate: [29.026, 40.986], trusted: true });
    expect(learning.layer.name).toBe('learned');
  });

  it('knows nothing about a door nobody confirmed', async () => {
    const learning = await open();
    await learning.confirm(input());
    expect(await learning.layer.lookup({ ...KEY, houseNumber: '42' })).toBeNull();
    expect(await learning.layer.lookup({ ...KEY, district: 'uskudar' })).toBeNull();
  });

  it('merges later confirmations of the same door and tells how many it holds', async () => {
    const learning = await open();
    await learning.confirm(input({ source: 'delivery', point: [29.0260, 40.9860], accuracyM: 8 }));
    const second = await learning.confirm(input({ source: 'delivery', point: [29.0261, 40.9860], accuracyM: 8 }));
    expect(second).toEqual({ ok: true, trusted: true, count: 2 });
    const point = await learning.layer.lookup(KEY);
    expect(distanceM(point?.coordinate as [number, number], [29.02605, 40.986])).toBeLessThan(0.5);
  });

  it('does not trust a single delivery', async () => {
    const learning = await open();
    expect(await learning.confirm(input({ source: 'delivery' }))).toMatchObject({ ok: true, trusted: false });
    expect((await learning.layer.lookup(KEY))?.trusted).toBe(false);
  });

  it('survives a restart on the same store', async () => {
    const store = memoryStore();
    await (await open(store)).confirm(input());
    const again = await open(store);
    expect(await again.layer.lookup(KEY)).toEqual({ coordinate: [29.026, 40.986], trusted: true });
    expect(again.stats()).toEqual({ keys: 1, confirmations: 1, damaged: 0, newer: 0 });
  });

  it('stamps confirmations with the injected clock', async () => {
    const store = memoryStore();
    await (await open(store)).confirm(input());
    expect([...store.snapshot().values()][0]).toContain('"at":1700000000');
  });

  it('floors the clock to whole seconds and survives a clock that is not a number', async () => {
    const store = memoryStore();
    const learning = await createLearning({ store, now: () => 1_700_000_000.9 });
    await learning.confirm(input());
    expect([...store.snapshot().values()][0]).toContain('"at":1700000000}');
    const brokenStore = memoryStore();
    const broken = await createLearning({ store: brokenStore, now: () => Number.NaN });
    expect(await broken.confirm(input())).toMatchObject({ ok: true });
    expect(JSON.parse([...brokenStore.snapshot().values()][0] as string).confirmations[0].at).toBe(0);
  });

  it('uses the real clock when none is given', async () => {
    const store = memoryStore();
    const learning = await createLearning({ store });
    await learning.confirm(input());
    const at = JSON.parse([...store.snapshot().values()][0] as string).confirmations[0].at as number;
    expect(Math.abs(at - Date.now() / 1000)).toBeLessThan(5);
  });
});

describe('createLearning refuses bad input', () => {
  const cases: [string, unknown, string][] = [
    ['null', null, 'invalid-input'],
    ['a number', 5, 'invalid-input'],
    ['no place', { point: [29, 41], source: 'pin' }, 'invalid-input'],
    ['place is text', { place: 'x', point: [29, 41], source: 'pin' }, 'invalid-input'],
    ['place without components', { place: { region: '34' }, point: [29, 41], source: 'pin' }, 'invalid-input'],
    ['NaN longitude', { place: place(), point: [Number.NaN, 41], source: 'pin' }, 'invalid-point'],
    ['Infinity latitude', { place: place(), point: [29, Infinity], source: 'pin' }, 'invalid-point'],
    ['point is text', { place: place(), point: '29,41', source: 'pin' }, 'invalid-point'],
    ['point is too short', { place: place(), point: [29], source: 'pin' }, 'invalid-point'],
    ['point in the sea west of Türkiye', { place: place(), point: [10, 41], source: 'pin' }, 'invalid-point'],
    ['point east of Türkiye', { place: place(), point: [45.5, 41], source: 'pin' }, 'invalid-point'],
    ['point south of Türkiye', { place: place(), point: [29, 35], source: 'pin' }, 'invalid-point'],
    ['point north of Türkiye', { place: place(), point: [29, 43], source: 'pin' }, 'invalid-point'],
    ['longitude is text', { place: place(), point: ['29', 41], source: 'pin' }, 'invalid-point'],
    ['latitude is text', { place: place(), point: [29, '41'], source: 'pin' }, 'invalid-point'],
    ['unknown source', { place: place(), point: [29, 41], source: 'sms' }, 'invalid-source'],
    ['no source', { place: place(), point: [29, 41] }, 'invalid-source'],
    ['place that names no door', { place: place({ components: { province: 'İstanbul', district: 'Kadıköy' } }), point: [29, 41], source: 'pin' }, 'no-key'],
  ];

  it.each(cases)('%s', async (_name, bad, reason) => {
    const store = memoryStore();
    const learning = await open(store);
    expect(await learning.confirm(bad as ConfirmInput)).toEqual({ ok: false, reason });
    expect(store.snapshot().size).toBe(0);
    expect(learning.stats().keys).toBe(0);
  });

  it('accepts the edges of the box around Türkiye', async () => {
    const learning = await open();
    for (const point of [[25.5, 36], [45, 41], [29, 35.5], [29, 42.5], [44.9, 41], [29, 35.6], [29, 42.4]] as [number, number][]) {
      expect(await learning.confirm(input({ point, source: 'delivery' }))).toMatchObject({ ok: true });
    }
  });

  it('treats a negative, zero, infinite or text accuracy as unknown instead of refusing', async () => {
    for (const accuracyM of [-3, 0, Infinity, Number.NaN, 'x' as unknown as number]) {
      const store = memoryStore();
      const learning = await open(store);
      expect(await learning.confirm(input({ accuracyM }))).toMatchObject({ ok: true });
      expect([...store.snapshot().values()][0]).not.toContain('accuracyM');
    }
  });

  it('keeps a huge accuracy as it is', async () => {
    const store = memoryStore();
    await (await open(store)).confirm(input({ accuracyM: 5000 }));
    expect([...store.snapshot().values()][0]).toContain('"accuracyM":5000');
  });
});

describe('createLearning with a number given apart from the place', () => {
  const streetLevel = (): Place => place({ components: { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Caferağa', street: 'Moda Caddesi' }, precision: 'street' });

  it('learns a door from a street level place once the number is given', async () => {
    const store = memoryStore();
    const learning = await open(store);
    expect(await learning.confirm({ place: streetLevel(), houseNumber: '40', point: [29.026, 40.986], source: 'pin' })).toEqual({ ok: true, trusted: true, count: 1 });
    expect(await learning.layer.lookup(KEY)).toEqual({ coordinate: [29.026, 40.986], trusted: true });
    expect(JSON.parse([...store.snapshot().values()][0] as string).text).toBe(formatLabel(components, 'tr'));
  });

  it('refuses a street level place without any number', async () => {
    const learning = await open();
    expect(await learning.confirm({ place: streetLevel(), point: [29.026, 40.986], source: 'pin' })).toEqual({ ok: false, reason: 'no-key' });
    expect(await learning.confirm({ place: streetLevel(), houseNumber: '  ', point: [29.026, 40.986], source: 'pin' })).toEqual({ ok: false, reason: 'no-key' });
    expect(await learning.confirm({ place: streetLevel(), houseNumber: 40 as unknown as string, point: [29.026, 40.986], source: 'pin' })).toEqual({ ok: false, reason: 'no-key' });
  });

  it('lets the given number win over the one the place carries', async () => {
    const learning = await open();
    await learning.confirm({ place: place(), houseNumber: '42', point: [29.03, 40.99], source: 'pin' });
    expect(await learning.layer.lookup(KEY)).toBeNull();
    expect(await learning.layer.lookup({ ...KEY, houseNumber: '42' })).toMatchObject({ coordinate: [29.03, 40.99] });
  });
});

describe('createLearning privacy', () => {
  it('stores nothing but the schema fields, whatever else the caller passes', async () => {
    const store = memoryStore();
    const learning = await open(store);
    const hostile = { ...input(), name: 'Ahmet Yılmaz', phone: '0532 000 00 00', orderId: 'S-4411', note: 'kapıyı komşu açtı', place: { ...place({ label: 'Ahmet Yılmaz teslim' }), customer: 'Ahmet' } };
    await learning.confirm(hostile as unknown as ConfirmInput);
    const raw = [...store.snapshot().values()].join('\n') + learning.exportLines().join('\n');
    for (const leak of ['Ahmet', '0532', 'S-4411', 'komşu', 'customer']) expect(raw).not.toContain(leak);
    const record = JSON.parse([...store.snapshot().values()][0] as string);
    expect(Object.keys(record).sort()).toEqual(['confirmations', 'key', 'region', 'text', 'v']);
    expect(Object.keys(record.confirmations[0]).sort()).toEqual(['at', 'lat', 'lng', 'source']);
    expect(record.text).toBe(formatLabel(components, 'tr'));
  });
});

describe('createLearning limits', () => {
  it('keeps the newest twenty confirmations of a door', async () => {
    const store = memoryStore();
    let tick = 1000;
    const learning = await createLearning({ store, now: () => tick++ });
    for (let i = 0; i < 25; i++) await learning.confirm(input({ source: 'delivery', point: [29.026 + i * 1e-6, 40.986] }));
    const record = JSON.parse([...store.snapshot().values()][0] as string);
    expect(record.confirmations).toHaveLength(20);
    expect(record.confirmations[0].at).toBe(1005);
    expect(record.confirmations[19].at).toBe(1024);
    expect(learning.stats().confirmations).toBe(20);
  });

  it('loses no confirmation when many arrive at once', async () => {
    const learning = await open();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => learning.confirm(input({ source: 'delivery', point: [29.026 + i * 1e-6, 40.986] }))));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(learning.stats()).toMatchObject({ keys: 1, confirmations: 10 });
    expect(results.map((r) => (r.ok ? r.count : 0)).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('survives a thousand confirmations of one door', async () => {
    const learning = await open();
    for (let i = 0; i < 1000; i++) await learning.confirm(input({ source: 'delivery', point: [29.026 + i * 1e-7, 40.986] }));
    expect(learning.stats().confirmations).toBe(20);
  });
});

describe('createLearning when the store fails', () => {
  const failing = (): LearnStore => ({ readAll: async () => [], write: async () => { throw new Error('disk full'); }, remove: async () => undefined });

  it('reports the failure and keeps its memory as it was', async () => {
    const learning = await open(failing());
    expect(await learning.confirm(input())).toEqual({ ok: false, reason: 'store-failed' });
    expect(await learning.layer.lookup(KEY)).toBeNull();
    expect(learning.stats().keys).toBe(0);
  });

  it('keeps working for the next confirmation after a failed one', async () => {
    let fail = true;
    const store = memoryStore();
    const flaky: LearnStore = { readAll: () => store.readAll(), remove: (k) => store.remove(k), write: async (k, v) => { if (fail) throw new Error('x'); await store.write(k, v); } };
    const learning = await open(flaky);
    await learning.confirm(input());
    fail = false;
    expect(await learning.confirm(input())).toEqual({ ok: true, trusted: true, count: 1 });
  });

  it('fails to open when the store cannot be read', async () => {
    await expect(createLearning({ store: { readAll: async () => { throw new Error('gone'); }, write: async () => undefined, remove: async () => undefined } })).rejects.toThrow('gone');
  });
});

describe('createLearning with rows it cannot read', () => {
  const good = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', confirmations: [{ source: 'pin', lng: 29.1, lat: 40.9, at: 5 }] });

  it('starts, counts them and leaves them in the store', async () => {
    const store = memoryStore();
    await store.write('a', '{broken');
    await store.write('b', JSON.stringify({ v: 9, key: 'b' }));
    await store.write(composeKey(KEY), good);
    const learning = await open(store);
    expect(learning.stats()).toEqual({ keys: 1, confirmations: 1, damaged: 1, newer: 1 });
    expect(store.snapshot().get('a')).toBe('{broken');
    expect(store.snapshot().get('b')).toContain('"v":9');
  });

  it('keeps a copy of an unreadable row before replacing it', async () => {
    const store = memoryStore();
    await store.write(composeKey(KEY), '{broken');
    const learning = await open(store);
    await learning.confirm(input());
    expect(store.snapshot().get(`~old:${composeKey(KEY)}`)).toBe('{broken');
    expect(await learning.layer.lookup(KEY)).toMatchObject({ trusted: true });
    expect(learning.stats().damaged).toBe(0);
  });

  it('does not read backup rows as records', async () => {
    const store = memoryStore();
    await store.write(`~old:x`, '{broken');
    expect((await open(store)).stats()).toEqual({ keys: 0, confirmations: 0, damaged: 0, newer: 0 });
  });
});

describe('createLearning export, import and forget', () => {
  it('exports sorted lines and imports them into an empty learner', async () => {
    const a = await open();
    await a.confirm(input());
    await a.confirm(input({ place: place({ components: { ...components, houseNumber: '12' } }), source: 'delivery', point: [29.03, 40.99] }));
    const lines = a.exportLines();
    expect(lines).toHaveLength(2);
    expect([...lines].sort()).toEqual(lines);
    const b = await open();
    expect(await b.importLines(lines)).toEqual({ added: 2, merged: 0, skipped: 0 });
    const strip = (list: string[]) => list.map((l) => ({ ...JSON.parse(l), text: undefined }));
    expect(strip(b.exportLines())).toEqual(strip(lines));
    expect(await b.layer.lookup(KEY)).toEqual(await a.layer.lookup(KEY));
  });

  it('does not count the same line twice', async () => {
    const a = await open();
    await a.confirm(input({ source: 'delivery' }));
    const b = await open();
    await b.importLines(a.exportLines());
    expect(await b.importLines(a.exportLines())).toEqual({ added: 0, merged: 0, skipped: 0 });
    expect(b.stats().confirmations).toBe(1);
  });

  it('merges new confirmations of a known door and counts it', async () => {
    const a = await open();
    await a.confirm(input({ source: 'delivery', point: [29.026, 40.986] }));
    const other = await open();
    await other.confirm(input({ source: 'delivery', point: [29.0261, 40.986] }));
    expect(await a.importLines(other.exportLines())).toEqual({ added: 0, merged: 1, skipped: 0 });
    expect(a.stats().confirmations).toBe(2);
    expect((await a.layer.lookup(KEY))?.trusted).toBe(true);
  });

  it('skips damaged, newer and out of place lines and keeps the rest', async () => {
    const a = await open();
    await a.confirm(input());
    const good = a.exportLines()[0] as string;
    const outside = JSON.stringify({ v: 1, key: composeKey({ ...KEY, houseNumber: '9' }), region: '34', text: 't', confirmations: [{ source: 'pin', lng: 10, lat: 41, at: 1 }] });
    const wrongRegion = JSON.stringify({ v: 1, key: composeKey(KEY), region: '06', text: 't', confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1 }] });
    const shortKey = JSON.stringify({ v: 1, key: 'a|b', region: 'a', text: 't', confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1 }] });
    const b = await open();
    const result = await b.importLines(['{oops', JSON.stringify({ v: 7, key: 'x' }), outside, wrongRegion, shortKey, '', good]);
    expect(result).toEqual({ added: 1, merged: 0, skipped: 5 });
    expect(b.stats().keys).toBe(1);
  });

  it('keeps the newest twenty by time even when a file lists them oldest last', async () => {
    const confirmations = Array.from({ length: 25 }, (_, i) => ({ source: 'delivery', lng: 29.026, lat: 40.986, at: 2000 - i }));
    const learning = await open();
    await learning.importLines([JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', confirmations })]);
    const record = JSON.parse(learning.exportLines()[0] as string);
    expect(record.confirmations.map((c: { at: number }) => c.at)).toEqual(Array.from({ length: 20 }, (_, i) => 1981 + i));
  });

  it('counts a line as skipped when the store refuses it', async () => {
    const learning = await open({ readAll: async () => [], write: async () => { throw new Error('full'); }, remove: async () => undefined });
    const line = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1 }] });
    expect(await learning.importLines([line])).toEqual({ added: 0, merged: 0, skipped: 1 });
    expect(learning.stats().keys).toBe(0);
  });

  it('forgets one door or everything, rows it could not read included', async () => {
    const store = memoryStore();
    const learning = await open(store);
    await learning.confirm(input());
    await learning.confirm(input({ place: place({ components: { ...components, houseNumber: '12' } }) }));
    await store.write('junk', '{x');
    await learning.forget(composeKey(KEY));
    expect(await learning.layer.lookup(KEY)).toBeNull();
    expect(learning.stats().keys).toBe(1);
    await learning.forget();
    expect(store.snapshot().size).toBe(0);
    expect(learning.stats()).toEqual({ keys: 0, confirmations: 0, damaged: 0, newer: 0 });
  });
});
