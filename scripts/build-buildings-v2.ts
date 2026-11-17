import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { attachEntrances, prepare, settlementsOf, writeBuildingPack, type Entrance, type OsmBuildingTag, type PlaceNode, type Row, type Settlement, type Trace } from '../pipeline/build/building-pack-v2';
import { metres, type Pt } from '../pipeline/build/building-link';
import { openBuildings2 } from '../src/core/address/buildings2';
import { openSqlite } from '../src/node/sqlite';
import { recordMeasure } from '../tools/compare/measures';
import { heldOut, packsDir, repoRoot } from './addr-sets';
import { readChains } from './addr-buildings-eval';

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

export function addressPackOf(plate: string): string {
  const evalFile = join(repoRoot, 'dist', 'eval-packs', 's4', plate, 'address.sqlite');
  if (existsSync(evalFile)) return evalFile;
  const dir = join(packsDir(), plate);
  return join(dir, readdirSync(dir).find((f) => f.startsWith('address-') && f.endsWith('.sqlite')) as string);
}

type Raw = { id: string; lon: number; lat: number; area: number; ring: Pt[]; height: number | null; floors: number | null; name: string | null; cls: string | null; src: string | null; rec: string | null };

export type FloorStats = { known: number; exact: number; within1: number; abs: number; bySource: Record<string, { n: number; within1: number }> };

export function floorStats(traces: Trace[], pack: ReturnType<typeof readChains>, tags: Map<string, OsmBuildingTag>): FloorStats {
  const hiddenTraces = traces.map((t) => ({ ...t, floors: null }));
  const hidden = prepare(hiddenTraces, pack.chains, new Map());
  let exact = 0;
  let within1 = 0;
  let abs = 0;
  let known = 0;
  const bySource: Record<string, { n: number; within1: number }> = {};
  for (const r of hidden) {
    const osm = r.trace.rec && r.trace.rec.startsWith('w') ? tags.get(r.trace.rec.split('@')[0] as string) : undefined;
    if (!osm || osm.levels === null) continue;
    known++;
    const diff = Math.abs(r.floors - osm.levels);
    abs += diff;
    if (diff === 0) exact++;
    if (diff <= 1) within1++;
    const name = ['', 'num_floors', 'height', 'height', 'region'][r.floorsSource] as string;
    const e = (bySource[name] ??= { n: 0, within1: 0 });
    e.n++;
    if (diff <= 1) e.within1++;
  }
  return { known, exact, within1, abs, bySource };
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34').split(',');
  const tags = new Map(lines<OsmBuildingTag>(join(work, 'building-tags', 'osm-buildings.jsonl')).map((t) => [t.id, t]));
  const entrances = lines<Entrance>(join(work, 'building-tags', 'entrances.jsonl'));
  const nodes = lines<PlaceNode>(join(work, 'building-tags', 'settlements.jsonl'));
  const results: Record<string, unknown> = {};
  for (const plate of plates) {
    const started = Date.now();
    const raw = lines<Raw>(join(work, 'building-traces', `${plate}.jsonl`));
    const traces: Trace[] = raw.map((r) => ({ ...r, height: r.height ?? null, floors: r.floors ?? null }));
    const pack = readChains(plate, addressPackOf(plate));
    const half = process.env.LABEL_HALF;
    const held = process.env.LABEL_HELD === '1';
    const labels = pack.doors.filter((d) => (half === undefined || (half === 'A' ? d.street % 2 === 0 : d.street % 2 === 1)) && !(held && heldOut(d.lon, d.lat))).map((d) => ({ lon: d.lon, lat: d.lat, street: d.street }));
    const rows = prepare(traces, pack.chains, tags, labels);
    const here = entrances.filter((e) => rows.length > 0 && e.lon >= Math.min(...rows.slice(0, 5000).map((r) => r.trace.lon)) - 1 && e.lon <= Math.max(...rows.slice(0, 5000).map((r) => r.trace.lon)) + 1);
    const settlements: Settlement[] = settlementsOf(nodes, rows);
    const out = join(repoRoot, 'dist', 'eval-packs', process.env.BUILD_NAME ?? 's5', plate);
    mkdirSync(out, { recursive: true });
    const file = join(out, 'buildings2.sqlite');
    const stats = writeBuildingPack(file, plate, rows, attachEntrances(rows, here), 'osm-261028', settlements);
    const sources = [0, 0, 0, 0, 0];
    for (const r of rows) sources[r.floorsSource]!++;
    const f = floorStats(traces, pack, tags);
    const db = openSqlite(file);
    const openStarted = performance.now();
    const reader = await openBuildings2(db);
    const openMs = performance.now() - openStarted;
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const t = rows[(i * 997) % rows.length] as Row;
      const s = performance.now();
      await reader.at([t.trace.lon, t.trace.lat]);
      times.push(performance.now() - s);
    }
    times.sort((a, b) => a - b);
    await db.close();
    const sizeMb = statSync(file).size / 1e6;
    const villageDoors = readVillageDoors(addressPackOf(plate));
    const village = settlements.filter((s) => s.buildings >= 3).map((s) => {
      const near = villageDoors.filter((d) => metres([s.lon, s.lat], d) <= 1000);
      return near.length >= 5 ? near.map((d) => metres([s.lon, s.lat], d)).sort((a, b) => a - b)[Math.floor(near.length / 2)] : null;
    }).filter((v): v is number => v !== null);
    const pct = (a: number, b: number): number => Number(((100 * a) / Math.max(1, b)).toFixed(1));
    results[plate] = {
      buildings: stats.buildings, linked: pct(rows.filter((r) => r.link).length, rows.length),
      floors: { sources: { num_floors: pct(sources[1]!, rows.length), osm: pct(sources[2]!, rows.length), height: pct(sources[3]!, rows.length), region: pct(sources[4]!, rows.length) }, known: f.known, exact: pct(f.exact, f.known), within1: pct(f.within1, f.known), mae: Number((f.abs / Math.max(1, f.known)).toFixed(2)), bySource: f.bySource },
      sizeMb: Number(sizeMb.toFixed(1)), openMs: Number(openMs.toFixed(1)), atP95Ms: Number((times[Math.floor(times.length * 0.95)] ?? 0).toFixed(2)), entrances: stats.entrances, settlements: settlements.length, villageMedianM: village.length ? Math.round(village.sort((a, b) => a - b)[Math.floor(village.length / 2)] as number) : null, villages: village.length,
      seconds: Math.round((Date.now() - started) / 1000),
    };
    console.log(plate, JSON.stringify(results[plate]));
  }
  if (process.env.BUILD_NAME === undefined) recordMeasure('a5_build', results);
}

function readVillageDoors(file: string): Pt[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT lon, lat FROM address WHERE street_id IS NULL').all() as { lon: number; lat: number }[]).map((r) => [r.lon / 1e6, r.lat / 1e6] as Pt);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
