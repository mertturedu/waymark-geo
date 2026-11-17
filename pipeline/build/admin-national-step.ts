import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Point, Polygon } from '../../src/core/region/geom';
import { reconcilePlate, type DistrictInput, type HoodInput, type NationalStats, type OfficialUnits, type Seed } from './admin-national';

type AdminRow = { id: string; level: number; parent: string | null; names: Record<string, string>; rings: Polygon[] };
type PlaceNode = { id: string; type?: string; kind?: string; name: string; lon: number; lat: number };

const readRows = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T) : []);

export function loadSeeds(workDir: string): Seed[] {
  const seen = new Set<string>();
  const out: Seed[] = [];
  for (const file of [join('building-tags', 'settlements.jsonl'), 'places-neighbourhood.jsonl']) {
    for (const row of readRows<PlaceNode>(join(workDir, file))) {
      if (seen.has(row.id) || !row.name) continue;
      seen.add(row.id);
      out.push({ id: row.id, kind: row.type ?? row.kind ?? 'locality', name: row.name, lon: row.lon, lat: row.lat });
    }
  }
  return out;
}

const POINT = /"lat": (-?[\d.]+), "lon": (-?[\d.]+)/;

export async function loadBuildingPoints(workDir: string, plate: string): Promise<Point[]> {
  const file = join(workDir, 'building-traces', `${plate}.jsonl`);
  const points: Point[] = [];
  if (!existsSync(file)) return points;
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const m = POINT.exec(line);
    if (m) points.push([Number(m[2]), Number(m[1])]);
  }
  return points;
}

export const loadOfficial = (repoRoot: string): OfficialUnits => JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'official', 'units.json'), 'utf8')) as OfficialUnits;

export type PlateOutcome = { plate: string; stats: NationalStats; units: number };

export async function writeNationalRows(input: { workDir: string; plate: string; official: OfficialUnits; seeds: Seed[] }): Promise<PlateOutcome> {
  const { workDir, plate } = input;
  const admin = readRows<AdminRow>(join(workDir, 'admin-pack', `${plate}.jsonl`));
  const nameOf = (r: AdminRow): string => r.names.tr ?? Object.values(r.names)[0] ?? r.id;
  const districts: DistrictInput[] = admin.filter((r) => r.level === 6).map((r) => ({ id: r.id, name: nameOf(r), rings: r.rings }));
  const ids = new Set(districts.map((d) => d.id));
  const hoods: HoodInput[] = admin.filter((r) => r.level === 8 && ids.has(r.parent as string)).map((r) => ({ id: r.id, district: r.parent as string, name: nameOf(r), rings: r.rings }));
  const buildings = await loadBuildingPoints(workDir, plate);
  const result = reconcilePlate({ plate, districts, hoods, official: input.official[plate] ?? {}, seeds: input.seeds, buildings });
  const dir = join(workDir, 'admin-national');
  mkdirSync(dir, { recursive: true });
  const lines = [
    ...result.marks.map((m) => JSON.stringify({ hood: m.hood, sid: m.sid, official: m.official })),
    ...result.units.map((u) => JSON.stringify({ district: u.district, name: u.name, sid: u.sid, source: u.source, official: u.official, center: u.center, rings: u.rings })),
  ];
  const file = join(dir, `${plate}.jsonl`);
  writeFileSync(`${file}.tmp`, `${lines.join('\n')}\n`);
  renameSync(`${file}.tmp`, file);
  return { plate, stats: result.stats, units: result.units.length };
}
