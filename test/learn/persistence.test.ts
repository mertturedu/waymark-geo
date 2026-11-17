import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearch } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';
import { composeKey } from '../../src/core/learn/key';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { fileStore } from '../../src/node/learn-store';
import { address, where } from '../pipeline/helpers/mini-work';
import { builtPack, memoryStore, searchRows, turkeyBorders } from '../address/helpers/search-fixture';

const KEY = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };
const dir = (): string => mkdtempSync(join(tmpdir(), 'geo-persist-'));
const now = () => 1_700_000_000;

async function searchOn(file: string, layers: Parameters<typeof createSearch>[0]['layers']) {
  const { store } = await memoryStore({ '34': file });
  const search = createSearch({ store, borders: turkeyBorders(), layers });
  const find = async (text: string): Promise<Place> => {
    const r = await search.resolve(text);
    const list = r.status === 'resolved' || r.status === 'ambiguous' ? r.candidates : [];
    return list.find((p) => p.components.district === 'Kadıköy') as Place;
  };
  return { search, find };
}

describe('K4.7 learned doors are kept', () => {
  it('after the application restarts', async () => {
    const path = join(dir(), 'learned.json');
    const first = await createLearning({ store: fileStore(path), now });
    const v1 = await builtPack();
    const { find } = await searchOn(v1, [first.layer]);
    await first.confirm({ place: await find('Gül Sokak 20'), point: [28.66, 40.76], source: 'pin' });
    const again = await createLearning({ store: fileStore(path), now });
    expect(await again.layer.lookup(KEY)).toEqual({ coordinate: [28.66, 40.76], trusted: true });
    expect(again.stats()).toEqual({ keys: 1, confirmations: 1, damaged: 0, newer: 0 });
  });

  it('when the pack is replaced by a newer one whose rows have other ids', async () => {
    const learning = await createLearning({ store: learnStore(), now });
    const v1 = await builtPack();
    const first = await searchOn(v1, [learning.layer]);
    await learning.confirm({ place: await first.find('Gül Sokak 20'), point: [28.66, 40.76], source: 'pin' });
    await learning.confirm({ place: await first.find('Gül Sokak 14'), point: [28.651, 40.751], source: 'pin' });
    const rows = searchRows();
    rows.addresses.unshift(address('n1', 'Aaa Sokak', '1', 28.9, 40.9, where('r10', 'r20')), address('n2', 'Aaa Sokak', '3', 28.9, 40.91, where('r10', 'r20')));
    rows.addresses = rows.addresses.filter((a) => (a as { id: string }).id !== 'n10');
    const v2 = await builtPack(rows);
    expect(v2).not.toBe(v1);
    const second = await searchOn(v2, [learning.layer]);
    expect(await second.find('Gül Sokak 20')).toMatchObject({ source: 'learned', coordinate: [28.66, 40.76], approximate: false });
    const removed = await second.find('Gül Sokak 14');
    expect(removed).toMatchObject({ source: 'learned', coordinate: [28.651, 40.751], approximate: false });
    expect(removed.id).toMatch(/^34:l:\d+:14:\d+:\d+$/);
  });

  it('after a schema change, the old rows are read and the new ones are written next to them', async () => {
    const path = join(dir(), 'learned.json');
    const old = { v: 0, key: composeKey(KEY), region: '34', label: 'Gül Sokak No:20, Moda Mah., Kadıköy/İstanbul', points: [{ lng: 28.66, lat: 40.76, kind: 'pin', t: 1_699_000_000 }] };
    writeFileSync(path, JSON.stringify({ rows: { [composeKey(KEY)]: JSON.stringify(old) } }));
    const learning = await createLearning({ store: fileStore(path), now });
    expect(await learning.layer.lookup(KEY)).toEqual({ coordinate: [28.66, 40.76], trusted: true });
    expect(learning.exportLines().map((l) => JSON.parse(l).v)).toEqual([1]);
    const v1 = await builtPack();
    const { find } = await searchOn(v1, [learning.layer]);
    await learning.confirm({ place: await find('Gül Sokak 20'), point: [28.6601, 40.76], source: 'delivery' });
    const stored = JSON.parse(readFileSync(path, 'utf8')).rows[composeKey(KEY)];
    expect(JSON.parse(stored).v).toBe(1);
    expect(JSON.parse(stored).confirmations).toHaveLength(2);
  });

  it('when a newer version of the application wrote some of them', async () => {
    const path = join(dir(), 'learned.json');
    const future = JSON.stringify({ v: 2, key: composeKey({ ...KEY, houseNumber: '99' }), anything: 'goes' });
    writeFileSync(path, JSON.stringify({ rows: { [composeKey({ ...KEY, houseNumber: '99' })]: future } }));
    const learning = await createLearning({ store: fileStore(path), now });
    const { find } = await searchOn(await builtPack(), [learning.layer]);
    await learning.confirm({ place: await find('Gül Sokak 20'), point: [28.66, 40.76], source: 'pin' });
    await learning.forget(composeKey(KEY));
    const rows = JSON.parse(readFileSync(path, 'utf8')).rows as Record<string, string>;
    expect(rows[composeKey({ ...KEY, houseNumber: '99' })]).toBe(future);
    expect(learning.stats().newer).toBe(1);
  });
});
