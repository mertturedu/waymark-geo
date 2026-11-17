import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildBuildingPack2, readDoors } from '../pipeline/build/building-pack2';
import { SOURCE_OSM } from '../pipeline/build/building-numbers';
import { distanceM } from '../src/core/geo/distance';
import { repoRoot } from './addr-sets';

const work = join(repoRoot, 'dist', 'work', '261028');
const rowsOf = (dir: string, plate: string): string => join(work, dir, `${plate}.rows.jsonl`);

type Truth = { street: number; num: number; lon: number; lat: number };
type Built = { chain: number; lon: number; lat: number; num: string | null; pnum: number | null };

const quantile = (list: number[], q: number): number => (list.length === 0 ? NaN : [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(q * list.length))]!);

function score(file: string, truth: Truth[]): { known: number; errors: number[]; anchored: number } {
  const db = new DatabaseSync(file, { readOnly: true });
  const byChain = new Map<number, Built[]>();
  let anchored = 0;
  for (const b of db.prepare('SELECT chain, lon, lat, num, pnum FROM building WHERE chain IS NOT NULL AND (num IS NOT NULL OR pnum IS NOT NULL)').all() as Built[]) {
    if (b.num !== null) anchored += 1;
    byChain.set(b.chain, [...(byChain.get(b.chain) ?? []), b]);
  }
  db.close();
  const errors: number[] = [];
  for (const t of truth) {
    const hits = (byChain.get(t.street) ?? []).filter((b) => (b.num !== null ? Number.parseInt(b.num, 10) === t.num : b.pnum === t.num));
    if (hits.length === 0) continue;
    errors.push(Math.min(...hits.map((b) => distanceM([b.lon / 1e6, b.lat / 1e6], [t.lon, t.lat]))));
  }
  return { known: errors.length, errors, anchored };
}

function apply(plates: string[]): void {
  for (const plate of plates) {
    const addressFile = join(work, 'packs', plate, 'address.sqlite');
    const result = buildBuildingPack2({ province: plate, workDir: work, addressFile, outFile: join(work, 'packs', plate, 'buildings2.sqlite'), osmTimestamp: '2026-10-28T21:21:02Z' });
    console.log(plate, JSON.stringify({ buildings: result.buildings, numbers: result.numbers, bytes: result.bytes }));
  }
}

function main(): void {
  if (process.argv[2] === 'apply') return apply(process.argv.slice(3));
  const plates = process.argv.slice(2);
  const lines = ['| İl | OSM kapısı (sınav) | Çapa: eski | Çapa: yeni | Bulunan: eski | Bulunan: yeni | Ortanca: eski | Ortanca: yeni | 30 m içinde: eski | 30 m içinde: yeni |', '|---|---|---|---|---|---|---|---|---|---|'];
  const pooled = { truth: 0, a: [] as number[], b: [] as number[] };
  for (const plate of plates) {
    const addressFile = join(work, 'packs', plate, 'address.sqlite');
    const db = new DatabaseSync(addressFile, { readOnly: true });
    const truth = (db.prepare("SELECT street_id, num, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND suffix = ''").all() as { street_id: number; num: number; lon: number; lat: number }[]).map((r) => ({ street: r.street_id, num: r.num, lon: r.lon / 1e6, lat: r.lat / 1e6 }));
    db.close();
    const result: Record<string, ReturnType<typeof score>> = {};
    for (const [name, dirs] of [['a', ['overture']], ['b', ['overture', 'fsq']]] as const) {
      const out = join(repoRoot, 'dist', 'eval-packs', `fsq-${name}`, plate);
      mkdirSync(out, { recursive: true });
      const doors = readDoors(addressFile, dirs.map((d) => rowsOf(d, plate))).filter((d) => d.src !== SOURCE_OSM);
      buildBuildingPack2({ province: plate, workDir: work, addressFile, outFile: join(out, 'buildings2.sqlite'), osmTimestamp: 't', doors });
      result[name] = score(join(out, 'buildings2.sqlite'), truth);
    }
    const a = result.a!;
    const b = result.b!;
    const pct = (n: number, d: number): string => `%${((100 * n) / Math.max(1, d)).toFixed(1)}`;
    const near = (e: number[]): string => pct(e.filter((x) => x <= 30).length, truth.length);
    lines.push(`| ${plate} | ${truth.length} | ${a.anchored} | ${b.anchored} | ${pct(a.known, truth.length)} | ${pct(b.known, truth.length)} | ${Math.round(quantile(a.errors, 0.5))} m | ${Math.round(quantile(b.errors, 0.5))} m | ${near(a.errors)} | ${near(b.errors)} |`);
    console.log(lines[lines.length - 1]);
    pooled.truth += truth.length;
    for (const e of a.errors) pooled.a.push(e);
    for (const e of b.errors) pooled.b.push(e);
  }
  const pct = (n: number): string => `%${((100 * n) / Math.max(1, pooled.truth)).toFixed(1)}`;
  lines.push(`| Toplam | ${pooled.truth} | | | ${pct(pooled.a.length)} | ${pct(pooled.b.length)} | ${Math.round(quantile(pooled.a, 0.5))} m | ${Math.round(quantile(pooled.b, 0.5))} m | ${pct(pooled.a.filter((x) => x <= 30).length)} | ${pct(pooled.b.filter((x) => x <= 30).length)} |`);
  console.log(lines.join('\n'));
}

main();
