import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildQueries, sourcesOf, type GoldenQuery } from './build-address-golden';
import { PRIORITY, codeOf, goldenOf, repoRoot } from './measure-address';
import { createNodePackStore } from '../src/node/pack-store';

export type Refresh = { kept: GoldenQuery[]; removed: GoldenQuery[]; added: GoldenQuery[]; unreplaced: number };

export function refreshQueries(existing: GoldenQuery[], present: (q: GoldenQuery) => boolean, fresh: GoldenQuery[]): Refresh {
  const kept = existing.filter(present);
  const removed = existing.filter((q) => !present(q));
  const used = new Set(kept.map((q) => `${q.expect.osm}#${q.expect.number}`));
  const added: GoldenQuery[] = [];
  const pool = fresh.filter((q) => !used.has(`${q.expect.osm}#${q.expect.number}`));
  for (const gone of removed) {
    const at = pool.findIndex((q) => q.category === gone.category && !used.has(`${q.expect.osm}#${q.expect.number}`));
    if (at < 0) continue;
    const [chosen] = pool.splice(at, 1) as [GoldenQuery];
    used.add(`${chosen.expect.osm}#${chosen.expect.number}`);
    added.push(chosen);
  }
  return { kept, removed, added, unreplaced: removed.length - added.length };
}

export function renderRefresh(tag: string, rows: { plate: string; total: number; refresh: Refresh }[]): string {
  const lines = [`# Altın sorgu bakımı (${tag})`, '', '| İl | Sorgu | Silinen ya da değişen | Yenisiyle değişen | Değişmeyen eksik |', '|---|---|---|---|---|', ...rows.map((r) => `| ${r.plate} | ${r.total} | ${r.refresh.removed.length} | ${r.refresh.added.length} | ${r.refresh.unreplaced} |`), ''];
  for (const r of rows.filter((x) => x.refresh.removed.length > 0)) {
    lines.push(`## ${r.plate}`, '');
    for (const q of r.refresh.removed.slice(0, 40)) lines.push(`- ${q.id}: "${q.text}" (${q.expect.osm}#${q.expect.number}) pakette artık yok`);
    lines.push('');
  }
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  const apply = argv.includes('--apply');
  const tagAt = argv.indexOf('--tag');
  const tag = tagAt >= 0 ? (argv[tagAt + 1] as string) : 'yayin';
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const rows: { plate: string; total: number; refresh: Refresh }[] = [];
  for (const plate of PRIORITY) {
    const db = await store.open(plate);
    if (!db) throw new Error(`${plate}: paket yok`);
    const existing = goldenOf(plate);
    const have = new Set((await db.all<{ osm: number; number: string }>('SELECT osm, number FROM address')).map((r) => `${r.osm}#${r.number}`));
    const { rows: sources, pois } = await sourcesOf(db, plate);
    const refresh = refreshQueries(existing, (q) => have.has(`${codeOf(q.expect.osm)}#${q.expect.number}`), buildQueries(sources, pois, plate, 2026));
    rows.push({ plate, total: existing.length, refresh });
    if (apply && refresh.removed.length > 0) writeFileSync(join(repoRoot, 'fixtures', 'address-golden', `${plate}.json`), JSON.stringify({ version: 1, plate, queries: [...refresh.kept, ...refresh.added] }, null, 1) + '\n');
    await db.close();
  }
  const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `faz-8-altin-bakim-${tag}.md`), renderRefresh(tag, rows));
  const removed = rows.reduce((a, r) => a + r.refresh.removed.length, 0);
  console.log(JSON.stringify({ removed, added: rows.reduce((a, r) => a + r.refresh.added.length, 0), applied: apply }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).then((code) => process.exit(code));
