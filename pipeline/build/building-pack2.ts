import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decodeLines } from '../../src/core/region/geom';
import type { Chain, Pt } from './building-link';
import { link } from './building-link';
import { placeDoors, predictNumbers, SOURCE_DIRECTORY, SOURCE_OSM, type Door, type NumberStats } from './building-numbers';
import { streetOf } from './street-names';
import { streetKey } from '../../src/core/text/street';
import { readHoodIndex } from './hood-index';
import { loadUnnamedRoads, ROAD_LINK_M } from './unnamed-roads';
import { attachEntrances, prepare, settlementsOf, writeBuildingPack, type Entrance, type OsmBuildingTag, type PlaceNode, type Trace } from './building-pack-v2';

export type BuildingPack2Input = { province: string; workDir: string; addressFile: string; outFile: string; osmTimestamp: string; doors?: Door[] };
export type BuildingPack2Result = { written: boolean; buildings: number; linked: number; roadLinked?: number; numbers?: NumberStats; entrances: number; bytes: number };

const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

export function readChains(addressFile: string): { chains: Chain[]; doors: { lon: number; lat: number; street: number }[] } {
  const db = new DatabaseSync(addressFile, { readOnly: true });
  try {
    const names = new Map((db.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const parts = new Map<number, Pt[][]>();
    for (const row of db.prepare('SELECT name_id, geom FROM street_part WHERE src = 0 ORDER BY id').all() as { name_id: number; geom: Uint8Array }[]) {
      parts.set(row.name_id, [...(parts.get(row.name_id) ?? []), ...(decodeLines(row.geom) as Pt[][])]);
    }
    const chains = [...parts].sort((a, b) => a[0] - b[0]).map(([id, l]) => ({ id, name: names.get(id) ?? '', lines: l }));
    const doors = (db.prepare('SELECT street_id, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL ORDER BY id').all() as { street_id: number; lon: number; lat: number }[]).map((r) => ({ lon: r.lon / 1e6, lat: r.lat / 1e6, street: r.street_id }));
    return { chains, doors };
  } finally {
    db.close();
  }
}

export function readDoors(addressFile: string, businessFiles: string | string[]): Door[] {
  const db = new DatabaseSync(addressFile, { readOnly: true });
  const out: Door[] = [];
  try {
    for (const r of db.prepare('SELECT street_id, num, number, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL ORDER BY id').all() as { street_id: number; num: number; number: string; lon: number; lat: number }[]) {
      out.push({ lon: r.lon / 1e6, lat: r.lat / 1e6, num: r.num, text: r.number, src: SOURCE_OSM, street: r.street_id });
    }
  } finally {
    db.close();
  }
  for (const file of [businessFiles].flat()) {
    if (!existsSync(file)) continue;
    for (const r of lines<{ lon: number; lat: number; addr: string | null }>(file)) {
      if (!r.addr) continue;
      const spoken = streetOf(r.addr);
      const num = spoken ? Number.parseInt(spoken.number, 10) : Number.NaN;
      if (!spoken || !Number.isFinite(num)) continue;
      out.push({ lon: r.lon, lat: r.lat, num, text: spoken.number, src: SOURCE_DIRECTORY, streetKey: spoken.key });
    }
  }
  return out;
}

export function buildBuildingPack2(input: BuildingPack2Input): BuildingPack2Result {
  const tracesFile = join(input.workDir, 'building-traces', `${input.province}.jsonl`);
  if (!existsSync(tracesFile)) return { written: false, buildings: 0, linked: 0, entrances: 0, bytes: 0 };
  const tagsDir = join(input.workDir, 'building-tags');
  const raw = lines<Trace & { height?: number | null; floors?: number | null }>(tracesFile);
  if (raw.length === 0) return { written: false, buildings: 0, linked: 0, entrances: 0, bytes: 0 };
  const traces: Trace[] = raw.map((r) => ({ ...r, height: r.height ?? null, floors: r.floors ?? null }));
  const tags = new Map(lines<OsmBuildingTag>(join(tagsDir, 'osm-buildings.jsonl')).map((t) => [t.id, t]));
  const nodes = lines<PlaceNode>(join(tagsDir, 'settlements.jsonl'));
  const { chains, doors } = readChains(input.addressFile);
  const rows = prepare(traces, chains, tags, doors);
  let west = Infinity;
  let east = -Infinity;
  for (const r of rows) {
    if (r.trace.lon < west) west = r.trace.lon;
    if (r.trace.lon > east) east = r.trace.lon;
  }
  const entrances = lines<Entrance>(join(tagsDir, 'entrances.jsonl')).filter((e) => e.lon >= west - 0.1 && e.lon <= east + 0.1);
  mkdirSync(dirname(input.outFile), { recursive: true });
  const temporary = `${input.outFile}.tmp`;
  const index = readHoodIndex(input.addressFile);
  const hoods = rows.map((r) => index.at(r.trace.lon, r.trace.lat));
  const unnamed = loadUnnamedRoads(input.workDir, input.province, (lon, lat) => index.at(lon, lat));
  for (const r of rows) {
    if (r.link) continue;
    const hit = link(unnamed.index, { id: r.trace.id, lon: r.trace.lon, lat: r.trace.lat, area: r.trace.area, ring: r.trace.ring }, ROAD_LINK_M);
    if (hit) r.road = { id: hit.component + 1, distanceM: hit.distanceM };
  }
  const doors2 = input.doors ?? readDoors(input.addressFile, ['overture', 'fsq'].map((dir) => join(input.workDir, dir, `${input.province}.rows.jsonl`)));
  const chainKeys = new Map(chains.map((c) => [c.id, streetKey(c.name).key]));
  const placed = placeDoors(rows, doors2, chainKeys);
  const predicted = predictNumbers(rows, placed.anchors);
  const numberStats: NumberStats = { doors: doors2.length, placed: [...placed.anchors.values()].reduce((a, l) => a + l.length, 0), conflicts: placed.conflicts, ...predicted.stats };
  const stats = writeBuildingPack(temporary, input.province, rows, attachEntrances(rows, entrances), input.osmTimestamp, settlementsOf(nodes, rows), hoods, unnamed.roads, predicted.numbers, predicted.ranges);
  rmSync(input.outFile, { force: true });
  renameSync(temporary, input.outFile);
  return { written: true, numbers: numberStats, buildings: stats.buildings, linked: rows.filter((r) => r.link).length, roadLinked: rows.filter((r) => !r.link && r.road).length, entrances: stats.entrances, bytes: statSync(input.outFile).size };
}
