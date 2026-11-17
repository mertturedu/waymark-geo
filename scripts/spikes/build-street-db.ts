import type { DatabaseSync } from 'node:sqlite';
import { fold, trigrams } from './street-query';

export type StreetRow = { name: string; lon: number; lat: number };

export function buildStreetDb(db: DatabaseSync, rows: StreetRow[]): void {
  db.exec(`
    CREATE TABLE street (id INTEGER PRIMARY KEY, name TEXT NOT NULL, fold TEXT NOT NULL, lon INTEGER NOT NULL, lat INTEGER NOT NULL);
    CREATE TABLE tri (t TEXT NOT NULL, sid INTEGER NOT NULL);
  `);
  const insertStreet = db.prepare('INSERT INTO street (name, fold, lon, lat) VALUES (?, ?, ?, ?)');
  const insertGram = db.prepare('INSERT INTO tri (t, sid) VALUES (?, ?)');
  db.exec('BEGIN');
  for (const row of rows) {
    const folded = fold(row.name);
    if (folded === '') continue;
    const { lastInsertRowid } = insertStreet.run(row.name, folded, Math.round(row.lon * 1e6), Math.round(row.lat * 1e6));
    for (const gram of trigrams(folded)) insertGram.run(gram, lastInsertRowid);
  }
  db.exec('COMMIT');
  db.exec('CREATE INDEX tri_t ON tri(t)');
}
