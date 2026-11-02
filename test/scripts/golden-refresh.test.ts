import { refreshQueries, renderRefresh } from '../../scripts/golden-refresh';
import type { GoldenQuery } from '../../scripts/build-address-golden';

const q = (id: string, osm: string, number: string, category: GoldenQuery['category'] = 'full'): GoldenQuery => ({ id, text: `metin ${id}`, category, lang: 'tr', expect: { plate: '34', osm, number, streetName: 'Moda Caddesi' } });

describe('golden maintenance', () => {
  const existing = [q('a', 'n1', '5'), q('b', 'n2', '7'), q('c', 'n3', '9', 'typo')];
  const fresh = [q('x', 'n10', '1', 'typo'), q('y', 'n11', '2'), q('z', 'n1', '5')];

  it('keeps what is still in the pack and replaces what is gone with the same kind of query', () => {
    const result = refreshQueries(existing, (query) => query.id !== 'b' && query.id !== 'c', fresh);
    expect(result.kept.map((x) => x.id)).toEqual(['a']);
    expect(result.removed.map((x) => x.id)).toEqual(['b', 'c']);
    expect(result.added.map((x) => x.id)).toEqual(['y', 'x']);
    expect(result.unreplaced).toBe(0);
  });

  it('never reuses a door the set already holds and reports what it could not replace', () => {
    const result = refreshQueries(existing, (query) => query.id === 'a', [q('z', 'n1', '5')]);
    expect(result.added).toEqual([]);
    expect(result.unreplaced).toBe(2);
  });

  it('changes nothing when every query is still present', () => {
    const result = refreshQueries(existing, () => true, fresh);
    expect(result).toMatchObject({ removed: [], added: [], unreplaced: 0 });
    expect(result.kept).toHaveLength(3);
  });

  it('lists each removed query by text in the report', () => {
    const result = refreshQueries(existing, (query) => query.id !== 'b', []);
    const text = renderRefresh('20261028.20261029', [{ plate: '34', total: 3, refresh: result }]);
    expect(text).toContain('| 34 | 3 | 1 | 0 | 1 |');
    expect(text).toContain('b: "metin b" (n2#7) pakette artık yok');
  });
});
