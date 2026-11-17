import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { attachEntrances, prepare, settlementsOf, writeBuildingPack, type Entrance, type OsmBuildingTag, type PlaceNode, type Trace } from '../pipeline/build/building-pack-v2';
import { createSearch } from '../src/core/address/search';
import { createBorders } from '../src/core/region/borders';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { BOX } from './build-building-device-set';
import { readChains } from './addr-buildings-eval';
import { addressPackOf } from './build-buildings-v2';
import { repoRoot, setsDir } from './addr-sets';

export const REVERSE_BOXES: Record<string, { west: number; south: number; east: number; north: number }> = { '34': BOX, '35': { west: 27.12, south: 38.42, east: 27.16, north: 38.45 } };

export type TapCase = { id: string; plate: string; point: [number, number]; options: { heading?: number; accuracyM?: number }; expected: unknown };

const work = join(repoRoot, 'dist', 'work', '261028');
const lines = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);

async function buildingPack(plate: string, dir: string): Promise<string> {
  const file = join(dir, `buildings2-${plate}.sqlite`);
  if (plate === '34') return file;
  const box = REVERSE_BOXES[plate]!;
  const raw = lines<Trace & { height?: number | null; floors?: number | null }>(join(work, 'building-traces', `${plate}.jsonl`));
  const traces = raw.filter((t) => t.lon >= box.west && t.lon <= box.east && t.lat >= box.south && t.lat <= box.north).map((t) => ({ ...t, height: t.height ?? null, floors: t.floors ?? null }));
  const tags = new Map(lines<OsmBuildingTag>(join(work, 'building-tags', 'osm-buildings.jsonl')).map((t) => [t.id, t]));
  const entrances = lines<Entrance>(join(work, 'building-tags', 'entrances.jsonl')).filter((e) => e.lon >= box.west && e.lon <= box.east && e.lat >= box.south && e.lat <= box.north);
  const nodes = lines<PlaceNode>(join(work, 'building-tags', 'settlements.jsonl'));
  const pack = readChains(plate, addressPackOf(plate));
  const rows = prepare(traces, pack.chains, tags);
  writeBuildingPack(file, plate, rows, attachEntrances(rows, entrances), 'osm-261028', settlementsOf(nodes, rows));
  return file;
}

async function main(): Promise<void> {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const cases: TapCase[] = [];
  for (const plate of ['34', '35']) {
    const buildingsFile = await buildingPack(plate, dir);
    copyFileSync(addressPackOf(plate), join(dir, `reverse-${plate}-address.sqlite`));
    const address = openSqlite(addressPackOf(plate));
    const buildings = openSqlite(buildingsFile);
    const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) } as PackStore;
    const search = createSearch({ store, borders });
    const box = REVERSE_BOXES[plate]!;
    const raw = lines<Trace>(join(work, 'building-traces', `${plate}.jsonl`)).filter((t) => t.lon >= box.west && t.lon <= box.east && t.lat >= box.south && t.lat <= box.north && t.area >= 60);
    for (let i = 0; i < 20; i++) {
      const t = raw[(i * 353 + 11) % raw.length]!;
      const shift = i % 4 >= 2 ? 0.00012 : 0;
      const point: [number, number] = [t.lon + shift, t.lat];
      const options = i % 4 === 3 ? { heading: (i * 47) % 360, accuracyM: 20 + (i % 5) * 15 } : {};
      const place = await search.reverse(point, options);
      cases.push({ id: `${plate}-${i}`, plate, point, options, expected: place });
    }
    await address.close();
    await buildings.close();
  }
  writeFileSync(join(dir, 'reverse-cases.json'), JSON.stringify(cases));
  const kinds = new Map<string, number>();
  for (const c of cases) kinds.set(((c.expected as { precision?: string } | null)?.precision) ?? 'yok', (kinds.get(((c.expected as { precision?: string } | null)?.precision) ?? 'yok') ?? 0) + 1);
  console.log(`${cases.length} dokunma`, Object.fromEntries(kinds), `, ${cases.filter((c) => (c.expected as { building?: unknown } | null)?.building).length} tanesi binayla`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
