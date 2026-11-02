import { createSearch } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import { createCorrections, correctionLines, reviewImport } from '../../src/core/learn/corrections';
import { composeKey } from '../../src/core/learn/key';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

const KEY = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };
const M = 111_195;
const east = (m: number): number => 28.66 + m / (M * Math.cos((40.76 * Math.PI) / 180));

const line = (confirmations: { source: string; lng: number; lat: number; at: number; accuracyM?: number }[], key = composeKey(KEY)): string =>
  JSON.stringify({ v: 1, key, region: '34', text: 'Gül Sokak No:20, Moda Mah., Kadıköy/İstanbul', confirmations });
const pin = { source: 'pin', lng: 28.66, lat: 40.76, at: 100 };
const delivery = (m: number, at = 200) => ({ source: 'delivery', lng: east(m), lat: 40.76, at, accuracyM: 10 });

describe('reviewImport', () => {
  it('accepts a door with a pin and writes the merged point', () => {
    const review = reviewImport([[line([pin])]]);
    expect(review.accepted).toEqual([{ v: 1, key: composeKey(KEY), region: '34', text: '34 kadikoy moda gul~sokak 20', lng: 28.66, lat: 40.76, count: 1 }]);
    expect(review.flagged).toEqual([]);
    expect(review.report).toContain('1 anahtar kabul');
  });

  it('accepts two close deliveries and merges the ones of two devices into one point', () => {
    const review = reviewImport([[line([delivery(0)])], [line([delivery(8, 300)])]]);
    expect(review.accepted).toHaveLength(1);
    expect(review.accepted[0]).toMatchObject({ count: 2 });
    expect(review.accepted[0]?.lng).toBeCloseTo(east(4), 6);
    expect(review.flagged).toEqual([]);
  });

  it('keeps a lone delivery out and tells why, unless it is asked to include singles', () => {
    const review = reviewImport([[line([delivery(0)])]]);
    expect(review.accepted).toEqual([]);
    expect(review.flagged).toEqual([{ key: composeKey(KEY), reason: 'single', detail: '1 teslimat onayı' }]);
    const included = reviewImport([[line([delivery(0)])]], { includeSingle: true });
    expect(included.accepted).toHaveLength(1);
    expect(included.flagged).toEqual([{ key: composeKey(KEY), reason: 'single', detail: '1 teslimat onayı, isteğe bağlı alındı' }]);
  });

  it('keeps deliveries that do not agree out', () => {
    const review = reviewImport([[line([delivery(0), delivery(120, 300)])]]);
    expect(review.accepted).toEqual([]);
    expect(review.flagged.map((f) => f.reason)).toEqual(['untrusted']);
  });

  it('flags a 300 m outlier among agreeing points but still accepts the door', () => {
    const review = reviewImport([[line([delivery(0), delivery(10, 300), delivery(300, 400)])]]);
    expect(review.accepted).toHaveLength(1);
    expect(review.accepted[0]?.lng).toBeCloseTo(east(5), 6);
    expect(review.flagged).toEqual([{ key: composeKey(KEY), reason: 'outlier', detail: '1 aykırı onay, en uzağı 295 m' }]);
  });

  it('flags a door whose points spread wide but are held together by a pin', () => {
    const review = reviewImport([[line([pin, delivery(40, 300), delivery(-40, 400)])]]);
    expect(review.accepted).toHaveLength(1);
    expect(review.flagged.map((f) => f.reason)).toEqual(['spread']);
  });

  it('keeps a door out when two devices disagree about it', () => {
    const review = reviewImport([[line([pin])], [line([{ ...pin, lng: east(200), at: 150 }])]]);
    expect(review.accepted).toEqual([]);
    expect(review.flagged).toEqual([{ key: composeKey(KEY), reason: 'conflict', detail: 'dosyalar 200 m ayrı nokta veriyor' }]);
  });

  it('does not count the same confirmation twice when a file is given twice', () => {
    const once = reviewImport([[line([delivery(0), delivery(6, 300)])]]);
    const twice = reviewImport([[line([delivery(0), delivery(6, 300)])], [line([delivery(0), delivery(6, 300)])]]);
    expect(twice.accepted).toEqual(once.accepted);
    expect(twice.flagged).toEqual([]);
  });

  it('counts and skips lines it cannot read', () => {
    const review = reviewImport([['{oops', '', JSON.stringify({ v: 9, key: 'x' }), line([pin])]]);
    expect(review.skippedLines).toBe(2);
    expect(review.accepted).toHaveLength(1);
    expect(review.report).toContain('2 satır okunamadı');
  });

  it('sorts accepted doors by key and gives the same answer for the same input', () => {
    const a = line([pin], composeKey({ ...KEY, houseNumber: '8' }));
    const b = line([pin], composeKey({ ...KEY, houseNumber: '30' }));
    const forward = reviewImport([[a, b]]);
    expect(forward.accepted.map((r) => r.key)).toEqual([composeKey({ ...KEY, houseNumber: '30' }), composeKey({ ...KEY, houseNumber: '8' })]);
    expect(reviewImport([[b, a]])).toEqual(forward);
  });

  it('writes a report that carries door keys and counts but nothing else', () => {
    const review = reviewImport([[line([delivery(0)])]]);
    expect(review.report).toContain(composeKey(KEY));
    expect(review.report).not.toMatch(/\d{2}\.\d{4,}/);
  });

  it('counts what was left out and what only drew a warning', () => {
    const lone = line([delivery(0)], composeKey({ ...KEY, houseNumber: '2' }));
    const noisy = line([delivery(0), delivery(10, 300), delivery(300, 400)], composeKey({ ...KEY, houseNumber: '4' }));
    const review = reviewImport([[lone, noisy, line([pin])]]);
    expect(review.report).toContain('- Okunan dosya: 1\n- 2 anahtar kabul, 1 anahtar dışarıda, 1 uyarı\n');
    expect(review.report).toContain('| Anahtar | Neden | Ayrıntı |');
    expect(review.report).toContain(`| ${composeKey({ ...KEY, houseNumber: '2' })} | single | 1 teslimat onayı |`);
  });

  it('skips a line whose key does not fit its region, has the wrong shape or has no usable point', () => {
    const wrongRegion = JSON.stringify({ v: 1, key: composeKey(KEY), region: '06', text: 't', confirmations: [pin] });
    const shortKey = JSON.stringify({ v: 1, key: 'a|b', region: 'a', text: 't', confirmations: [pin] });
    const outside = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', confirmations: [{ ...pin, lng: 10 }] });
    const review = reviewImport([[wrongRegion, shortKey, outside]]);
    expect(review.skippedLines).toBe(3);
    expect(review.accepted).toEqual([]);
  });

  it('writes the text of a door from its key, whatever the files say', () => {
    const a = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 'b metin', confirmations: [pin] });
    const b = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 'a metin', confirmations: [{ ...pin, at: 101 }] });
    expect(reviewImport([[a], [b]]).accepted[0]?.text).toBe('34 kadikoy moda gul~sokak 20');
    expect(reviewImport([[b], [a]]).accepted[0]?.text).toBe('34 kadikoy moda gul~sokak 20');
  });

  it('says plainly when there is nothing to review', () => {
    const review = reviewImport([[]]);
    expect(review.accepted).toEqual([]);
    expect(review.report).toContain('0 anahtar kabul');
  });
});

describe('createCorrections', () => {
  const lines = correctionLines(reviewImport([[line([pin])]]).accepted);

  it('serves each accepted door as a trusted correction', async () => {
    const layer = createCorrections(lines);
    expect(layer.name).toBe('correction');
    expect(await layer.lookup(KEY)).toEqual({ coordinate: [28.66, 40.76], trusted: true });
    expect(await layer.lookup({ ...KEY, houseNumber: '22' })).toBeNull();
  });

  it.each([
    ['a version that is not 1', { v: 2 }],
    ['no key', { key: undefined }],
    ['a key of the wrong length', { key: 'a|b' }],
    ['no region', { region: undefined }],
    ['no text', { text: undefined }],
    ['text for a longitude', { lng: 'x' }],
    ['text for a latitude', { lat: 'x' }],
    ['no count', { count: undefined }],
    ['a point north of the country', { lat: 43 }],
    ['a point south of the country', { lat: 35 }],
    ['a point west of the country', { lng: 25 }],
    ['a point east of the country', { lng: 46 }],
    ['not an object', 5],
  ])('refuses %s', async (_name, change) => {
    const good = { v: 1, key: composeKey(KEY), region: '34', text: 't', lng: 28.66, lat: 40.76, count: 1 };
    const bad = typeof change === 'object' ? { ...good, ...change } : change;
    expect(await createCorrections([JSON.stringify(bad)]).lookup(KEY)).toBeNull();
  });

  it('skips lines that are broken, outside the country or of another shape', async () => {
    const layer = createCorrections(['{oops', '', JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', lng: 10, lat: 41, count: 1 }), JSON.stringify({ key: 3 }), ...lines]);
    expect(await layer.lookup(KEY)).toEqual({ coordinate: [28.66, 40.76], trusted: true });
  });

  it('lists the corrected numbers of a street for neighbour estimates', async () => {
    const layer = createCorrections(correctionLines(reviewImport([[line([pin]), line([pin], composeKey({ ...KEY, houseNumber: '8' }))]]).accepted));
    const scope = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' };
    expect((await (layer.nearby as NonNullable<typeof layer.nearby>)(scope)).map((n) => [n.int, n.trusted])).toEqual([[8, true], [20, true]]);
    expect(await (layer.nearby as NonNullable<typeof layer.nearby>)({ ...scope, district: 'uskudar' })).toEqual([]);
  });
});

describe('export, review, correction layer: the same points and the same answers', () => {
  it('gives the resolver the same coordinates it got from the learner', async () => {
    const pack = await builtPack();
    const { store } = await memoryStore({ '34': pack });
    const learning = await createLearning({ store: learnStore(), now: () => 1_700_000_000, neighbours: 'all' });
    const learned = createSearch({ store, borders: turkeyBorders(), layers: [learning.layer] });
    const candidatesOf = async (s: typeof learned, text: string): Promise<Place[]> => {
      const r = await s.resolve(text);
      return r.status === 'resolved' || r.status === 'ambiguous' ? r.candidates : [];
    };
    const base = (await candidatesOf(learned, 'Gül Sokak 20')).find((p) => p.components.district === 'Kadıköy') as Place;
    const withNumber = (n: string): Place => ({ ...base, components: { ...base.components, houseNumber: n } });
    await learning.confirm({ place: withNumber('18'), point: [28.64, 40.7001], source: 'pin' });
    await learning.confirm({ place: withNumber('24'), point: [28.66, 40.7001], source: 'pin' });
    await learning.confirm({ place: withNumber('30'), point: [28.67, 40.7001], source: 'delivery' });
    await learning.confirm({ place: withNumber('30'), point: [28.6701, 40.7001], source: 'delivery' });
    const review = reviewImport([learning.exportLines()]);
    expect(review.accepted).toHaveLength(3);
    const corrected = createSearch({ store, borders: turkeyBorders(), layers: [createCorrections(correctionLines(review.accepted))] });
    for (const text of ['Gül Sokak 18', 'Gül Sokak 24', 'Gül Sokak 30', 'Gül Sokak 20', 'Gül Sokak 14', 'Gül Sokak 12']) {
      const a = await candidatesOf(learned, text);
      const b = await candidatesOf(corrected, text);
      expect(b.map((p) => [p.label, p.coordinate, p.precision, p.approximate])).toEqual(a.map((p) => [p.label, p.coordinate, p.precision, p.approximate]));
      expect(a.filter((p) => p.source === 'learned').map((p) => p.id)).toEqual(b.filter((p) => p.source === 'correction').map((p) => p.id));
    }
  });
});
