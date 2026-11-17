import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import { openSearch } from './addr-eval';
import { readSet, repoRoot, setsDir, type TextRecord } from './addr-sets';

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

export type StreetCase = { id: string; text: string; kind: 'named_by_business' | 'plain'; truth: [number, number]; expected: { status: string; point: [number, number] | null; street: string | null } };

export async function buildStreetSet(plate: string, derivedCount = 80, plainCount = 40): Promise<StreetCase[]> {
  const search = await openSearch(undefined, false, [plate]);
  const admin = new Map(lines<{ id: string; names: { tr?: string } }>(join(work, 'admin-full.jsonl')).map((r) => [r.id, r.names.tr ?? '']));
  const wanted: { id: string; text: string; kind: StreetCase['kind']; truth: [number, number] }[] = [];
  let n = 0;
  for (const row of lines<{ name: string; district: string; evidence: { lon: number; lat: number; number: string }[] }>(join(work, 'street-names', `${plate}.jsonl`))) {
    const e = row.evidence[0];
    if (!e || wanted.length >= derivedCount) continue;
    wanted.push({ id: `${plate}:n:${n++}`, text: `${row.name} ${e.number}, ${admin.get(row.district) ?? ''}, ${provinceName(plate) ?? plate}`, kind: 'named_by_business', truth: [e.lon, e.lat] });
  }
  for (const r of readSet<TextRecord>('g2', plate).filter((x) => !x.ops.includes('street_typo')).slice(0, plainCount)) wanted.push({ id: r.id, text: r.text, kind: 'plain', truth: [r.lng, r.lat] });
  const out: StreetCase[] = [];
  for (const w of wanted) {
    const result = await search.resolve(w.text);
    const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
    out.push({ ...w, expected: { status: result.status, point: best ? best.coordinate : null, street: best?.components.street ?? null } });
  }
  return out;
}

async function main(): Promise<void> {
  const plate = process.argv[2] ?? '34';
  const cases = await buildStreetSet(plate);
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `streets-${plate}.json`), JSON.stringify(cases));
  copyFileSync(join(repoRoot, 'dist', 'eval-packs', process.env.ADDR_PACKS ?? 's4', plate, 'address.sqlite'), join(dir, `streets-${plate}.sqlite`));
  console.log(`${plate}: ${cases.length} vaka, paket kopyalandı`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
