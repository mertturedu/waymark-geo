import { expoSqlDb } from '../../example/src/spikes/expoSqliteDb';
import { isHit, osmCode, pickQueries, timingNote } from '../../example/src/device-test/address-search-helpers';
import type { Place } from '../../src/core/address/types';

const place = (extra: Partial<Place> = {}): Place => ({
  id: '34:a:7', label: 'x', components: { street: 'Gül Sokak', houseNumber: '14' }, coordinate: [28.6, 40.7], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34', ...extra,
});

describe('expoSqlDb', () => {
  const fake = () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    let closed = 0;
    const db = {
      getAllAsync: async (sql: string, params: unknown[]) => (calls.push({ sql, params }), sql.includes('blob') ? [{ pts: new Uint8Array([1, 2, 3]) }] : [{ n: 1 }]),
      closeAsync: async () => void (closed += 1),
    };
    return { db, calls, closed: () => closed };
  };

  it('passes the parameters, an empty list when there are none', async () => {
    const { db, calls } = fake();
    const sql = expoSqlDb(db as never);
    await sql.all('SELECT ? + ?', [1, 'a']);
    await sql.all('SELECT 1');
    expect(calls).toEqual([{ sql: 'SELECT ? + ?', params: [1, 'a'] }, { sql: 'SELECT 1', params: [] }]);
  });

  it('hands binary columns back untouched', async () => {
    const { db } = fake();
    const rows = await expoSqlDb(db as never).all<{ pts: Uint8Array }>('SELECT blob');
    expect(rows[0]?.pts).toBeInstanceOf(Uint8Array);
    expect(Array.from(rows[0]?.pts ?? [])).toEqual([1, 2, 3]);
  });

  it('closes the database once and passes errors on', async () => {
    const { db, closed } = fake();
    await expoSqlDb(db as never).close();
    expect(closed()).toBe(1);
    const broken = expoSqlDb({ getAllAsync: async () => { throw new Error('bozuk'); }, closeAsync: async () => undefined } as never);
    await expect(broken.all('x')).rejects.toThrow('bozuk');
  });
});

describe('isHit', () => {
  const rows = [{ id: 7, number: '14', lng: 28.6, lat: 40.7 }];

  it('accepts the very row and a twin of the same number within thirty metres', () => {
    expect(isHit(place(), '34', rows)).toBe(true);
    expect(isHit(place({ id: '34:a:9', coordinate: [28.60005, 40.7] }), '34', rows)).toBe(true);
  });

  it('refuses another number, a far point, a guess and another province', () => {
    expect(isHit(place({ id: '34:a:9', components: { houseNumber: '16' } }), '34', rows)).toBe(false);
    expect(isHit(place({ id: '34:a:9', coordinate: [28.7, 40.7] }), '34', rows)).toBe(false);
    expect(isHit(place({ id: '34:g:1', precision: 'interpolated' }), '34', rows)).toBe(false);
    expect(isHit(place({ id: '06:a:7' }), '34', rows)).toBe(false);
  });
});

describe('pickQueries', () => {
  const list = Array.from({ length: 500 }, (_, i) => ({ id: `q${i}`, text: `t${i}`, category: i % 5 === 0 ? 'poi' : 'full', conflict: i % 50 === 1 ? true : undefined }));

  it('takes the asked number, evenly spread, without conflicts and places', () => {
    const picked = pickQueries(list as never, 200);
    expect(picked).toHaveLength(200);
    expect(picked.every((q) => q.category !== 'poi' && !q.conflict)).toBe(true);
    expect(pickQueries(list as never, 200).map((q) => q.id)).toEqual(picked.map((q) => q.id));
    expect(pickQueries(list.slice(0, 10) as never, 200).length).toBeLessThanOrEqual(10);
  });
});

describe('timingNote', () => {
  it('writes the percentiles in milliseconds', () => {
    const times = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(timingNote(times)).toEqual({ p50: 50, p95: 95, max: 100 });
    expect(timingNote([])).toEqual({ p50: 0, p95: 0, max: 0 });
  });
});

describe('osmCode', () => {
  it('matches the numbering of the pack: four times the id plus one for the kind', () => {
    expect(osmCode('n10')).toBe(40);
    expect(osmCode('w10')).toBe(41);
    expect(osmCode('r10')).toBe(42);
  });
});
