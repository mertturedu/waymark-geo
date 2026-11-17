import { makeQueries, summarise } from '../../scripts/spikes/street-queries';

const letter = (n: number): string => String.fromCharCode(97 + n);
const names = Array.from({ length: 300 }, (_, i) => `Örnek Mahalle ${letter(i % 26)}${letter(Math.floor(i / 26))} Caddesi`);

describe('makeQueries', () => {
  it('is deterministic for a seed and has the requested size', () => {
    const a = makeQueries(names, 42, 100);
    expect(a).toHaveLength(100);
    expect(makeQueries(names, 42, 100)).toEqual(a);
    expect(makeQueries(names, 43, 100)).not.toEqual(a);
  });

  it('makes one in five queries a one letter deletion of the real name', () => {
    const queries = makeQueries(names, 42, 500);
    const typos = queries.filter((q) => q.typo);
    expect(typos.length).toBeGreaterThan(70);
    expect(typos.length).toBeLessThan(130);
    typos.forEach((q) => {
      expect(q.q.length).toBe(q.name.length - 1);
      expect(q.q).not.toBe(q.name);
    });
    queries.filter((q) => !q.typo).forEach((q) => expect(q.q).toBe(q.name));
  });

  it('only deletes letters from names longer than five characters without digits', () => {
    const mixed = ['Abc', '1707. Sokak', 'Atatürk Caddesi'];
    const queries = makeQueries(mixed, 1, 300);
    queries.filter((q) => q.typo).forEach((q) => expect(q.name).toBe('Atatürk Caddesi'));
  });

  it('handles an empty name list', () => {
    expect(makeQueries([], 1, 10)).toEqual([]);
  });
});

describe('summarise', () => {
  it('reports percentiles and hit rates', () => {
    const result = summarise(
      Array.from({ length: 100 }, (_, i) => ({ ms: i + 1, firstOk: i < 90, topFiveOk: i < 97 })),
    );
    expect(result).toEqual({ count: 100, p50: 51, p95: 96, p99: 100, firstPercent: 90, topFivePercent: 97 });
  });

  it('is zero for no samples', () => {
    expect(summarise([])).toEqual({ count: 0, p50: 0, p95: 0, p99: 0, firstPercent: 0, topFivePercent: 0 });
  });
});
