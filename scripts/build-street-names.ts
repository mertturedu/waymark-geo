import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { deriveNames, validate, type Business, type NamedPart, type Way } from '../pipeline/build/street-names';
import { repoRoot, seeded, pick } from './addr-sets';

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

type Row = { name: string; lines: Way['lines']; ways: string[]; [k: string]: unknown };
type Overture = { id: string; name: string; brand: string | null; lon: number; lat: number; addr: string | null };

export function loadPlate(plate: string): { named: Row[]; unnamed: (Way & Record<string, unknown>)[]; businesses: Business[] } {
  const businesses = lines<Overture>(join(work, 'overture', `${plate}.rows.jsonl`)).filter((r): r is Overture & { addr: string } => !!r.addr).map((r) => ({ id: r.id, name: r.name, brand: r.brand, lon: r.lon, lat: r.lat, addr: r.addr }));
  return { named: lines<Row>(join(work, 'streets', plate, 'streets.jsonl')), unnamed: lines<Way & Record<string, unknown>>(join(work, 'unnamed', `${plate}.jsonl`)), businesses };
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,16,35,06').split(',');
  const outDir = join(work, 'street-names');
  mkdirSync(outDir, { recursive: true });
  const summary: Record<string, unknown> = {};
  let tried = 0;
  let proposed = 0;
  let correct = 0;
  let derivedTotal = 0;
  let unnamedTotal = 0;
  for (const plate of plates) {
    const { named, unnamed, businesses } = loadPlate(plate);
    const parts: NamedPart[] = named.map((r) => ({ name: r.name, lines: r.lines }));
    const derived = deriveNames(unnamed, businesses, parts);
    const byWay = new Map(unnamed.map((w) => [w.id, w]));
    const rows = derived.map((d) => {
      const way = byWay.get(d.wayId) as Way & Record<string, unknown>;
      return { alt: [], district: way.district, highway: way.highway, hoodName: way.hoodName, hoodNames: way.hoodNames, hoodSource: way.hoodSource, lines: way.lines, name: d.name, names: { tr: d.name }, neighbourhood: way.neighbourhood, ways: [way.id], derived: true, support: d.support, evidence: d.evidence };
    });
    writeFileSync(join(outDir, `${plate}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const rng = seeded(4040);
    const sample = Array.from({ length: Math.min(3000, named.length) }, () => pick(rng, named)).map((r) => ({ part: { name: r.name, lines: r.lines } as NamedPart, way: { id: r.ways[0] as string, lines: r.lines } as Way }));
    const v = validate(sample, businesses, parts);
    tried += v.tried;
    proposed += v.proposed;
    correct += v.correct;
    derivedTotal += derived.length;
    unnamedTotal += unnamed.length;
    summary[plate] = { unnamed: unnamed.length, derived: derived.length, validation: { ...v, precision: Number((100 * v.precision).toFixed(1)), coverage: Number((100 * v.coverage).toFixed(1)) } };
    console.log(plate, summary[plate]);
  }
  const precision = proposed === 0 ? 100 : (100 * correct) / proposed;
  const result = { plates, unnamed: unnamedTotal, derived: derivedTotal, tried, proposed, correct, precision: Number(precision.toFixed(1)), coverage: Number(((100 * proposed) / Math.max(1, tried)).toFixed(1)) };
  console.log(result);
  recordMeasure('a4_names', result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
