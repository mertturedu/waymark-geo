import { DatabaseSync } from 'node:sqlite';
import { buildStreetDb } from '../../scripts/spikes/build-street-db';

describe('buildStreetDb', () => {
  const rows = [
    { name: 'İstiklal Caddesi', lon: 29.05, lat: 41.05 },
    { name: 'Çiçek Sokağı', lon: 29.07, lat: 41.07 },
  ];

  it('creates the street and trigram tables with the folded name', () => {
    const db = new DatabaseSync(':memory:');
    buildStreetDb(db, rows);
    expect(db.prepare('SELECT count(*) AS n FROM street').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT name, fold FROM street ORDER BY id').all()).toEqual([
      { name: 'İstiklal Caddesi', fold: 'istiklal caddesi' },
      { name: 'Çiçek Sokağı', fold: 'cicek sokagi' },
    ]);
    expect((db.prepare('SELECT count(*) AS n FROM tri').get() as { n: number }).n).toBeGreaterThan(20);
  });

  it('stores coordinates as integers scaled by one million', () => {
    const db = new DatabaseSync(':memory:');
    buildStreetDb(db, rows);
    expect(db.prepare('SELECT lon, lat FROM street WHERE id = 1').get()).toEqual({ lon: 29050000, lat: 41050000 });
  });

  it('indexes trigrams for lookups', () => {
    const db = new DatabaseSync(':memory:');
    buildStreetDb(db, rows);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT sid FROM tri WHERE t IN (?, ?)').all(' ci', 'cic') as { detail: string }[];
    expect(plan.map((p) => p.detail).join(' ')).toContain('tri_t');
  });

  it('skips rows whose name folds to nothing', () => {
    const db = new DatabaseSync(':memory:');
    buildStreetDb(db, [...rows, { name: '...', lon: 1, lat: 1 }]);
    expect(db.prepare('SELECT count(*) AS n FROM street').get()).toEqual({ n: 2 });
  });
});
