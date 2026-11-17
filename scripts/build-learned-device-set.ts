import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildLearned } from '../pipeline/build/learned';
import { canonicalize, streetId } from '../pipeline/build/learned-resolve';
import { assemblePacks, defaultKeyDir, type RegionInput } from '../pipeline/build/manifest';
import type { DeliveryRecord } from '../pipeline/real/records';
import { createSearch, type Search } from '../src/core/address/search';
import { openBuildings2 } from '../src/core/address/buildings2';
import type { Place } from '../src/core/address/types';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import adminData from '../src/core/text/data/admin.json';
import { openSqlite } from '../src/node/sqlite';
import { deliveriesFor, pickCount, SIM_WEEK, type Spot } from '../test/sim/central';
import { chooseHidden, hidePack, readDoors } from '../test/sim/hide';
import { rng, shuffle } from '../test/sim/random';
import { targetsOf, type SimTarget } from '../test/sim/replay';
import { repoRoot } from './addr-sets';
import type { Sources } from './fetch-sources';

export const LEARNED_TEST_PLATE = '41';
export const LEARNED_TEST_DIR = join(repoRoot, 'dist', 'packs-learned-test');
const WORK = join(repoRoot, 'dist', 'work', '261028');
const DOOR_TARGETS = 60;
const FLOOR_TARGETS = 40;

export type Snapshot = { source: string; precision: string; coordinate: [number, number]; floor: { value: number; low: number; high: number; source: string } | null };
export type LearnedCase = { id: string; text: string; truth: [number, number]; before: Snapshot | null; after: Snapshot | null };

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function snapshot(place: Place | undefined): Snapshot | null {
  if (!place) return null;
  const floor = place.unit?.floor ?? null;
  return { source: place.source, precision: place.precision, coordinate: [round(place.coordinate[0]), round(place.coordinate[1])], floor: floor ? { value: floor.value, low: floor.low, high: floor.high, source: floor.source } : null };
}

export async function best(search: Search, text: string): Promise<Place | undefined> {
  const r = await search.resolve(text);
  return r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
}

const textOf = (t: SimTarget, province: string, tail = ''): string => `${t.street} ${t.door.number}${tail} ${t.neighbourhood ?? ''} ${t.district} ${province}`.replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  const plate = LEARNED_TEST_PLATE;
  const province = (adminData.provinces.find((p) => p.plate === plate)?.names as Record<string, string>).tr as string;
  const dir = join(WORK, 'packs', plate);
  const out = join(WORK, 'learned-device');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const rand = rng(1300 + Number(plate));
  const doors = readDoors(join(dir, 'address.sqlite'));
  const hidden = chooseHidden(doors, 0.2, rand);
  const addressFile = join(out, 'address.sqlite');
  hidePack(join(dir, 'address.sqlite'), addressFile, hidden);
  const buildingsFile = join(dir, 'buildings2.sqlite');
  const directoryFile = join(dir, 'directory.sqlite');

  const missing = targetsOf(addressFile, plate, doors.filter((d) => hidden.has(d.id)), DOOR_TARGETS * 3, rand);
  const buildingsDb = openSqlite(buildingsFile);
  const reader = await openBuildings2(buildingsDb);
  const known = targetsOf(addressFile, plate, shuffle(doors.filter((d) => !hidden.has(d.id)), rand).slice(0, 4000), 4000, rand);
  const inside: SimTarget[] = [];
  for (const t of known) {
    if (inside.length >= FLOOR_TARGETS * 2) break;
    if (await reader.at(t.truth, 3)) inside.push(t);
  }

  const records: DeliveryRecord[] = [];
  const doorTargets = missing.slice(0, DOOR_TARGETS);
  for (const t of doorTargets) records.push(...deliveriesFor(spotOf(t, plate), rand, 3 + pickCount(rand) % 3));
  const floorTargets: { t: SimTarget; door: number }[] = [];
  for (const t of inside) {
    const per = 3 + Math.floor(rand() * 3);
    const basement = rand() < 0.3 ? 1 : 0;
    const floorOf = (door: number): number => Math.ceil(door / per) - 1 - basement;
    const total = (6 + Math.floor(rand() * 6) + basement) * per;
    const pool = shuffle(Array.from({ length: total }, (_, i) => i + 1), rand);
    const learnt = pool.slice(0, 10);
    learnt.forEach((door, i) => records.push({ ...baseRecord(t, plate), src: `kur${i % 4}`, floor: String(floorOf(door)), door: String(door) }));
    floorTargets.push({ t, door: pool[10] as number });
  }

  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const learnedFile = join(out, 'learned.sqlite');
  const open = (withLearned: boolean): { search: Search; close: () => Promise<void> } => {
    const handles = [openSqlite(addressFile), openSqlite(buildingsFile), openSqlite(directoryFile), ...(withLearned ? [openSqlite(learnedFile)] : [])];
    const store: PackStore = { installed: async () => [plate], open: async () => handles[0] as never, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? handles[1] : kind === 'directory' ? handles[2] : kind === 'learned' ? (handles[3] ?? null) : null) as never };
    return {
      search: createSearch({ store, borders, layers: withLearned ? [createLearnedLayer(store)] : [] }),
      close: async () => {
        await Promise.all(handles.map((h) => h.close()));
      },
    };
  };
  const without = open(false);
  const canonical = await canonicalize(records, without.search);
  const stats = await buildLearned({ plate, records: canonical.records, nowWeek: SIM_WEEK, outFile: learnedFile, streetKnown: (district, street) => !canonical.unknownStreets.has(streetId(district, street)) });
  const withLearned = open(true);
  const cases: LearnedCase[] = [];
  for (const [i, t] of doorTargets.entries()) {
    const text = textOf(t, province);
    cases.push({ id: `door-${i}`, text, truth: [round(t.truth[0]), round(t.truth[1])], before: snapshot(await best(without.search, text)), after: snapshot(await best(withLearned.search, text)) });
  }
  let floors = 0;
  for (const { t, door } of floorTargets) {
    if (floors >= FLOOR_TARGETS) break;
    const text = textOf(t, province, ` Daire ${door}`);
    const after = snapshot(await best(withLearned.search, text));
    if (after?.floor?.source !== 'learned') continue;
    cases.push({ id: `floor-${floors++}`, text, truth: [round(t.truth[0]), round(t.truth[1])], before: snapshot(await best(without.search, text)), after });
  }
  await without.close();
  await withLearned.close();
  await buildingsDb.close();

  const names = adminData.provinces.find((p) => p.plate === plate)?.names as Record<string, string>;
  const region: RegionInput = {
    id: plate,
    tier: 'full',
    names,
    bbox: borders.provinceBounds(plate) as [number, number, number, number],
    stats: { addresses: doors.length - hidden.size, streets: 1, neighbourhoods: 1 },
    files: [{ kind: 'address', source: addressFile }, ...(existsSync(buildingsFile) ? [{ kind: 'buildings2' as const, source: buildingsFile }] : []), { kind: 'directory', source: directoryFile }, { kind: 'learned', source: learnedFile }],
  };
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as Sources;
  rmSync(LEARNED_TEST_DIR, { recursive: true, force: true });
  const base = join(out, 'base');
  mkdirSync(base, { recursive: true });
  await assemblePacks({ outDir: LEARNED_TEST_DIR, sources, regions: [region], baseDir: base, keyDir: defaultKeyDir(), minSdk: '0.3.0' });
  writeFileSync(join(LEARNED_TEST_DIR, 'set.json'), JSON.stringify({ plate, cases }));
  copyFileSync(join(LEARNED_TEST_DIR, 'set.json'), join(out, 'set.json'));
  const doorCases = cases.filter((c) => c.id.startsWith('door-'));
  const hit = doorCases.filter((c) => c.after?.source === 'learned').length;
  console.log(JSON.stringify({ out: LEARNED_TEST_DIR, doors: doorCases.length, learnedDoors: hit, floors: cases.length - doorCases.length, layouts: stats.layouts, keys: stats.keys, renamed: canonical.renamed, unresolved: canonical.unresolved }));
}

const spotOf = (t: SimTarget, plate: string): Spot => ({ plate, district: t.district, neighbourhood: t.neighbourhood, street: t.street, houseNumber: t.door.number, truth: t.truth });

const baseRecord = (t: SimTarget, plate: string): DeliveryRecord => ({ v: 1, src: 'kur0', week: SIM_WEEK, region: plate, district: t.district, ...(t.neighbourhood ? { neighbourhood: t.neighbourhood } : {}), street: t.street, houseNumber: t.door.number, coordSource: 'gps', gps: { lng: t.truth[0], lat: t.truth[1], accuracyM: 8 } });

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
