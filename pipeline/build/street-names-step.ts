import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveNames, type Business, type NamedPart, type Way } from './street-names';

type Row = { name: string; lines: Way['lines']; ways: string[]; [k: string]: unknown };
type Door = { id: string; street: string | null; number: string | null; lon: number; lat: number };
type Overture = { id: string; name: string; brand: string | null; lon: number; lat: number; addr: string | null };

const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

export type DerivedStats = { unnamed: number; derived: number };

export function writeDerivedStreetNames(workDir: string, plate: string): DerivedStats {
  const unnamedFile = join(workDir, 'unnamed', `${plate}.jsonl`);
  const businessFile = join(workDir, 'overture', `${plate}.rows.jsonl`);
  const out = join(workDir, 'street-names', `${plate}.jsonl`);
  mkdirSync(join(workDir, 'street-names'), { recursive: true });
  if (!existsSync(unnamedFile) || !existsSync(businessFile)) {
    writeFileSync(out, '');
    return { unnamed: 0, derived: 0 };
  }
  const named = lines<Row>(join(workDir, 'streets', plate, 'streets.jsonl'));
  const unnamed = lines<Way & Record<string, unknown>>(unnamedFile);
  const businesses: Business[] = lines<Overture>(businessFile).filter((r): r is Overture & { addr: string } => !!r.addr).map((r) => ({ id: r.id, name: r.name, brand: r.brand, lon: r.lon, lat: r.lat, addr: r.addr }));
  const parts: NamedPart[] = named.map((r) => ({ name: r.name, lines: r.lines }));
  const doorsFile = join(workDir, 'addresses', plate, 'addresses.jsonl');
  const doors: Business[] = existsSync(doorsFile) ? lines<Door>(doorsFile).filter((r) => r.street && r.number).map((r) => ({ id: `d${r.id}`, name: `d${r.id}`, brand: null, lon: r.lon, lat: r.lat, addr: `${r.street} ${r.number}` })) : [];
  const derived = deriveNames(unnamed, [...businesses, ...doors], parts);
  const byWay = new Map(unnamed.map((w) => [w.id, w]));
  const rows = derived.map((d) => {
    const way = byWay.get(d.wayId) as Way & Record<string, unknown>;
    return { alt: [], district: way.district, highway: way.highway, hoodName: way.hoodName, hoodNames: way.hoodNames, hoodSource: way.hoodSource, lines: way.lines, name: d.name, names: { tr: d.name }, neighbourhood: way.neighbourhood, ways: [way.id], derived: true, support: d.support, evidence: d.evidence };
  });
  writeFileSync(`${out}.tmp`, rows.length === 0 ? '' : rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  renameSync(`${out}.tmp`, out);
  return { unnamed: unnamed.length, derived: derived.length };
}
