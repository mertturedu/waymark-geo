import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { buildStreetDb, type StreetRow } from './build-street-db';
import { fold, searchStreets, type Driver } from './street-query';
import { makeQueries, summarise, type Sample, type StreetQuery } from './street-queries';

const arg = (name: string, fallback?: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? process.argv[at + 1] : fallback;
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};

const readRows = (path: string): StreetRow[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreetRow);

const command = process.argv[2];

if (command === 'build') {
  const out = arg('out');
  if (existsSync(out)) rmSync(out);
  const db = new DatabaseSync(out);
  const rows = readRows(arg('jsonl'));
  const unique = process.argv.includes('--unique') ? [...new Map(rows.map((r) => [r.name, r])).values()] : rows;
  buildStreetDb(db, unique);
  db.exec('VACUUM');
  db.close();
  console.log(`${out} ${(statSync(out).size / 1048576).toFixed(1)} MB`);
} else if (command === 'queries') {
  const names = [...new Set(readRows(arg('jsonl')).map((r) => r.name))];
  const queries = makeQueries(names, Number(arg('seed', '42')), Number(arg('count', '500')));
  writeFileSync(arg('out'), JSON.stringify(queries, null, 1) + '\n');
  console.log(`${queries.length} queries, ${queries.filter((q) => q.typo).length} with a typo`);
} else if (command === 'bench') {
  const db = new DatabaseSync(arg('db'));
  const driver: Driver = { all: async (sql, params) => db.prepare(sql).all(...params) as Record<string, string | number | null>[] };
  const queries = JSON.parse(readFileSync(arg('queries'), 'utf8')) as StreetQuery[];
  (async () => {
    const samples: Sample[] = [];
    for (const query of queries) {
      const started = performance.now();
      const hits = await searchStreets(driver, query.q, 5);
      const ms = performance.now() - started;
      const want = fold(query.name);
      samples.push({ ms, firstOk: hits[0]?.fold === want, topFiveOk: hits.some((h) => h.fold === want) });
    }
    const typo = queries.map((q, i) => ({ q, s: samples[i] as Sample }));
    console.log(JSON.stringify({ all: summarise(samples), exact: summarise(typo.filter((x) => !x.q.typo).map((x) => x.s)), typo: summarise(typo.filter((x) => x.q.typo).map((x) => x.s)) }));
  })();
} else {
  console.error('usage: street-tools.ts build|queries|bench');
  process.exit(2);
}
