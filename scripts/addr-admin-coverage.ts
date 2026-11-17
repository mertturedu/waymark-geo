import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { packsDir, plates, repoRoot } from './addr-sets';

export type Coverage = { plate: string; hoods: number; withPolygon: number; boundaries: number; addresses: number; withHood: number };

function boundaryCounts(): Map<string, number> {
  const rows = readFileSync(join(repoRoot, 'dist', 'work', '261028', 'admin-full.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { id: string; level: number; parent: string | null; iso?: string });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const counts = new Map<string, number>();
  for (const row of rows.filter((r) => r.level === 8)) {
    let cursor: (typeof rows)[number] | undefined = row;
    while (cursor && cursor.level !== 4) cursor = cursor.parent ? byId.get(cursor.parent) : undefined;
    const plate = cursor?.iso?.split('-')[1];
    if (plate) counts.set(plate, (counts.get(plate) ?? 0) + 1);
  }
  return counts;
}

export function coverageOf(plate: string, boundaries: number): Coverage | null {
  const dir = join(packsDir(), plate);
  const file = readdirSync(dir).find((f) => f.startsWith('address-') && f.endsWith('.sqlite'));
  if (!file) return null;
  const db = new DatabaseSync(join(dir, file), { readOnly: true });
  try {
    const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    return {
      plate,
      hoods: one('SELECT COUNT(*) n FROM neighbourhood'),
      withPolygon: one('SELECT COUNT(*) n FROM neighbourhood WHERE poly IS NOT NULL'),
      boundaries,
      addresses: one('SELECT COUNT(*) n FROM address'),
      withHood: one('SELECT COUNT(*) n FROM address WHERE hood_id IS NOT NULL'),
    };
  } finally {
    db.close();
  }
}

const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((100 * a) / b).toFixed(1)}`);

async function main(): Promise<void> {
  const counts = boundaryCounts();
  const rows = plates().map((p) => coverageOf(p, counts.get(p) ?? 0)).filter((r): r is Coverage => r !== null);
  const total = rows.reduce((t, r) => ({ hoods: t.hoods + r.hoods, withPolygon: t.withPolygon + r.withPolygon, boundaries: t.boundaries + r.boundaries, addresses: t.addresses + r.addresses, withHood: t.withHood + r.withHood }), { hoods: 0, withPolygon: 0, boundaries: 0, addresses: 0, withHood: 0 });
  const lines = ['# Mahalle sınırı kapsaması (81 il)', '', `Veri: ${packsDir().split('/').slice(-2, -1)[0]}`, '', '| İl | Mahalle (pakette) | Sınırlı mahalle | OSM sınır ilişkisi | Adres | Mahallesi atanmış adres |', '|---|---|---|---|---|---|'];
  for (const r of rows) lines.push(`| ${r.plate} | ${r.hoods} | ${pct(r.withPolygon, r.hoods)} | ${r.boundaries} | ${r.addresses} | ${pct(r.withHood, r.addresses)} |`);
  lines.push(`| **toplam** | ${total.hoods} | ${pct(total.withPolygon, total.hoods)} | ${total.boundaries} | ${total.addresses} | ${pct(total.withHood, total.addresses)} |`);
  const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-olcum');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `mahalle-kapsama-${new Date().toISOString().slice(0, 10)}.md`), lines.join('\n') + '\n');
  console.log(lines.slice(-1)[0]);
  recordMeasure('a3_coverage', { plates: rows.length, hoods: total.hoods, polygonShare: Number(((100 * total.withPolygon) / total.hoods).toFixed(1)), addressHoodShare: Number(((100 * total.withHood) / total.addresses).toFixed(1)) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
