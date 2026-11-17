import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLearned, type LearnedStats } from '../pipeline/build/learned';
import { hoodSuggestions, type HoodSuggestion } from '../pipeline/build/learned-hoods';
import { attachStops } from '../pipeline/build/learned-stops';
import { canonicalize, osmPointOf, streetId } from '../pipeline/build/learned-resolve';
import { snapToBuilding } from '../pipeline/build/learned-snap';
import { readRecords, type DeliveryRecord } from '../pipeline/real/records';
import { openBuildings2 } from '../src/core/address/buildings2';
import { createSearch } from '../src/core/address/search';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { openSqlite } from '../src/node/sqlite';
import { repoRoot } from './addr-sets';
import type { Sources } from './fetch-sources';

const WEEK_MS = 7 * 24 * 3600 * 1000;

export const defaultRecordsDir = (): string => join(homedir(), '.yuksi-geo', 'gercek');

export function recordFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  if (statSync(path).isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? recordFiles(full) : entry.name.endsWith('.jsonl') ? [full] : [];
  });
}

export async function buildProvince(plate: string, records: readonly DeliveryRecord[], packs: string, nowWeek: number): Promise<LearnedStats & { renamed: number; unresolved: number; withStop: number; noStop: number; hoodSuggestions: HoodSuggestion[] }> {
  const dir = join(packs, plate);
  const handles = ['address', 'directory', 'buildings2'].map((name) => (existsSync(join(dir, `${name}.sqlite`)) ? openSqlite(join(dir, `${name}.sqlite`)) : null));
  const [address, directory, buildings] = handles;
  if (!address) throw new Error(`${plate} için adres paketi yok: ${dir}`);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async (_, kind) => (kind === 'directory' ? directory : kind === 'buildings2' ? buildings : null) ?? null };
  try {
    const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
    const search = createSearch({ store, borders });
    const canonical = await canonicalize(records, search);
    const reader = buildings ? await openBuildings2(buildings) : undefined;
    const stopped = await attachStops(canonical.records, search, reader);
    const stats = await buildLearned({
      plate,
      records: stopped.records,
      nowWeek,
      outFile: join(dir, 'learned.sqlite'),
      osmPoint: osmPointOf(search, plate),
      ...(reader ? { snap: snapToBuilding(reader) } : {}),
      streetKnown: (district, street) => !canonical.unknownStreets.has(streetId(district, street)),
    });
    return { ...stats, renamed: canonical.renamed, unresolved: canonical.unresolved, withStop: stopped.withStop, noStop: stopped.noStop, hoodSuggestions: await hoodSuggestions(stopped.records, search) };
  } finally {
    for (const handle of handles) await handle?.close();
  }
}

async function main(): Promise<void> {
  const arg = (name: string): string | undefined => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as Sources;
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const input = arg('--records') ?? defaultRecordsDir();
  const nowWeek = Number(arg('--now-week') ?? Math.floor(Date.now() / WEEK_MS));
  const only = arg('--plates')?.split(',');
  const lines = recordFiles(input).flatMap((file) => readFileSync(file, 'utf8').split('\n'));
  const { records, rejected } = readRecords(lines);
  const byPlate = new Map<string, DeliveryRecord[]>();
  for (const r of records) if (!only || only.includes(r.region)) byPlate.set(r.region, [...(byPlate.get(r.region) ?? []), r]);
  if (byPlate.size === 0) {
    console.error(`kayıt yok: ${input} (önce Kargoio dışa aktarımı, ~/.yuksi-geo/gercek/<tarih>/records.jsonl)`);
    process.exit(2);
  }
  const report: Record<string, unknown> = {};
  for (const [plate, list] of [...byPlate].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    report[plate] = await buildProvince(plate, list, join(work, 'packs'), nowWeek);
    console.log(plate, JSON.stringify(report[plate]));
  }
  writeFileSync(join(work, 'learned-build.json'), JSON.stringify({ rejected, provinces: report }, null, 1));
  console.log(JSON.stringify({ rejected }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
