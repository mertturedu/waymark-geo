import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arrivalOf } from '../src/core/address/arrival';
import { openRegion } from '../src/core/address/pack';
import type { Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import { embeddedBorders } from '../src/core/region/embedded';
import { directionsOf } from '../src/core/route/directions';
import { createRouter } from '../src/core/route/router';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { repoRoot, setsDir } from './addr-sets';

export const ARRIVE_CASES = 40;
export const ARRIVE_ENTRANCES = 10;
export const ARRIVE_DIRECTIONS = 10;
const PLATE = '34';
const ORIGIN_M = 1500;
const ENTRANCE_OFFSET_M = 20;
const M_PER_DEGREE = 111_195;
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export type ArriveExpected = { to: [number, number]; side: 'left' | 'right' | null; offM: number; onChain: boolean; target: 'entrance' | 'door'; chain: boolean; last?: string };
export type ArriveCase = { id: string; street: string; hood: string | null; district: string | null; door: [number, number]; entrance: [number, number] | null; from: [number, number]; expected: ArriveExpected | null };

const fileIn = (kind: string): string => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'dist', 'test-data', 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; path: string }[] }[] };
  const file = manifest.regions.find((r) => r.id === PLATE)?.files.find((f) => f.kind === kind);
  if (!file) throw new Error(`${kind} parçası manifestte yok`);
  return join(repoRoot, 'dist', 'test-data', file.path);
};

type Row = { id: number; street_id: number; hood_id: number | null; district_id: number; lon: number; lat: number; name: string };

const doorsOf = async (db: ReturnType<typeof openSqlite>): Promise<Row[]> => db.all<Row>('SELECT a.id, a.street_id, a.hood_id, a.district_id, a.lon, a.lat, s.name FROM address a JOIN street_name s ON s.id = a.street_id WHERE a.street_id IS NOT NULL ORDER BY a.id', []);

const placeOf = (c: ArriveCase): Place => ({
  id: `${PLATE}:a:${c.id}`,
  label: '',
  components: { street: c.street, ...(c.hood ? { neighbourhood: c.hood } : {}), ...(c.district ? { district: c.district } : {}) },
  coordinate: c.door,
  precision: 'address',
  approximate: false,
  source: 'osm',
  confidence: 1,
  region: PLATE,
  ...(c.entrance ? { entrance: c.entrance } : {}),
});

export async function arriveCases(): Promise<ArriveCase[]> {
  const db = openSqlite(fileIn('address'));
  const region = await openRegion(db);
  const bytes = new Uint8Array(readFileSync(fileIn('route')));
  const router = createRouter({ store: { installed: async () => [PLATE], read: async () => bytes }, borders: embeddedBorders() });
  const rand = rng(1515);
  const out: ArriveCase[] = [];
  for (const row of shuffle(await doorsOf(db), rand)) {
    if (out.length >= ARRIVE_CASES) break;
    const door: LngLat = [round(row.lon / 1e6), round(row.lat / 1e6)];
    const angle = rand() * 2 * Math.PI;
    const from: [number, number] = [round(door[0] + (Math.cos(angle) * ORIGIN_M) / (M_PER_DEGREE * Math.cos((door[1] * Math.PI) / 180))), round(door[1] + (Math.sin(angle) * ORIGIN_M) / M_PER_DEGREE)];
    const hood = region.hoods.find((h) => h.id === row.hood_id)?.name ?? null;
    const district = region.districts.find((d) => d.id === row.district_id)?.name ?? null;
    const withEntrance = out.length >= ARRIVE_CASES - ARRIVE_ENTRANCES;
    const entrance: [number, number] | null = withEntrance ? [door[0], round(door[1] + ENTRANCE_OFFSET_M / M_PER_DEGREE)] : null;
    const item: ArriveCase = { id: `arrive-${out.length}`, street: row.name, hood, district, door: door as [number, number], entrance, from, expected: null };
    const arrive = await arrivalOf(region, placeOf(item));
    const got = await router.route(from, door, { arrive });
    if (!got.ok || !got.arrival) continue;
    const last = out.length < ARRIVE_DIRECTIONS ? (await directionsOf(got.geometry, 'tr', undefined, { side: got.arrival.side })).at(-1)?.text : undefined;
    item.expected = { to: [round(got.to[0]), round(got.to[1])], side: got.arrival.side, offM: got.arrival.offM, onChain: got.arrival.onChain, target: got.arrival.target, chain: (arrive.chain?.length ?? 0) > 0, ...(last ? { last } : {}) };
    out.push(item);
  }
  await db.close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  arriveCases().then((cases) => {
    const dir = join(setsDir(), 'device');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'arrive.json'), JSON.stringify(cases));
    const chained = cases.filter((c) => c.expected?.onChain).length;
    const sides = cases.filter((c) => c.expected?.side).length;
    console.log(JSON.stringify({ file: join(dir, 'arrive.json'), cases: cases.length, chained, sides }));
  });
}
