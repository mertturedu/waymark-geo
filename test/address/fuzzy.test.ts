import { fuzzyStreetNames } from '../../src/core/address/fuzzy';
import type { Region } from '../../src/core/address/pack';

const region = (keys: string[]): Region => ({ allNames: async () => keys.map((key, i) => ({ nameId: i + 1, ref: i + 1, lang: 'tr', key, name: key })) }) as unknown as Region;

describe('fuzzyStreetNames', () => {
  it('finds a street that is one letter off, a swap, or a letter short', async () => {
    const r = region(['basra', 'papatya', 'menekse', 'atatürk']);
    expect((await fuzzyStreetNames(r, 'barsa')).map((x) => x.key)).toEqual(['basra']);
    expect((await fuzzyStreetNames(r, 'papaya')).map((x) => x.key)).toEqual(['papatya']);
    expect((await fuzzyStreetNames(r, 'menkse')).map((x) => x.key)).toEqual(['menekse']);
  });

  it('keeps first or last letter as an anchor and skips short or far words', async () => {
    const r = region(['basra', 'xasra']);
    expect((await fuzzyStreetNames(r, 'basrx')).map((x) => x.key)).toEqual(['basra']);
    expect(await fuzzyStreetNames(r, 'abc')).toEqual([]);
    expect(await fuzzyStreetNames(r, 'zzzzzzz')).toEqual([]);
  });

  it('reads the names of a region only once', async () => {
    let reads = 0;
    const r = { allNames: async () => { reads++; return [{ nameId: 1, ref: 1, lang: 'tr', key: 'basra', name: 'basra' }]; } } as unknown as Region;
    await fuzzyStreetNames(r, 'basra');
    await fuzzyStreetNames(r, 'barsa');
    expect(reads).toBe(1);
  });
});

describe('fuzzyStreetNames with a region that can read names by length', () => {
  const names = [{ key: 'basra', ref: 1 }, { key: 'papatya', ref: 2 }, { key: 'ba sra', ref: 3 }];
  const make = (reads: number[][]): Region => ({ allNames: async () => { throw new Error('all'); }, namesByLength: async (_: string, lengths: number[]) => { reads.push(lengths); return names.filter((n) => lengths.includes(n.key.replace(/ /g, '').length)).map((n) => ({ nameId: n.ref, ref: n.ref, lang: 'tr', key: n.key, name: n.key })); } }) as unknown as Region;

  it('reads only the lengths near the word and each length once', async () => {
    const reads: number[][] = [];
    const r = make(reads);
    expect((await fuzzyStreetNames(r, 'barsa')).map((x) => x.ref).sort()).toEqual([1, 3]);
    expect(reads).toEqual([[3, 4, 5, 6, 7]]);
    await fuzzyStreetNames(r, 'papaya');
    expect(reads).toEqual([[3, 4, 5, 6, 7], [8]]);
  });
});
