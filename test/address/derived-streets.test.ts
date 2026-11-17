import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { createSearch } from '../../src/core/address/search';
import { part, where, writeWork } from '../pipeline/helpers/mini-work';
import { memoryStore, searchRows, turkeyBorders } from './helpers/search-fixture';

async function pack(withDerived: boolean): Promise<{ file: string; streets: number }> {
  const dir = writeWork(searchRows(), undefined, '34');
  if (withDerived) {
    mkdirSync(join(dir, 'street-names'), { recursive: true });
    const row = part('Yeni Öğrenilen Sokağı', where('r10', 'r20'), [[[28.7, 40.8], [28.7005, 40.8]]], ['w900']);
    writeFileSync(join(dir, 'street-names', '34.jsonl'), JSON.stringify({ ...row, derived: true, support: 3 }) + '\n');
  }
  const file = join(dir, '34.sqlite');
  const stats = await buildAddressPack({ province: '34', workDir: dir, outFile: file, osmTimestamp: 't' });
  return { file, streets: stats.streets };
}

describe('street names learned from businesses', () => {
  it('adds the learned street to the pack when the street-names file is there', async () => {
    const plain = await pack(false);
    const learned = await pack(true);
    expect(learned.streets).toBe(plain.streets + 1);
  });

  it('finds the learned street by name', async () => {
    const { file } = await pack(true);
    const { store, close } = await memoryStore({ '34': file });
    try {
      const search = createSearch({ store, borders: turkeyBorders() });
      const result = await search.resolve('Yeni Öğrenilen Sokağı 3 Kadıköy İstanbul');
      const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      expect(best?.components.street).toBe('Yeni Öğrenilen Sokağı');
    } finally {
      await close();
    }
  });
});
