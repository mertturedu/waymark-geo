import type { LngLat } from '../geo/cells';
import type { SqlDb } from '../ports';
import { decodeLine } from '../region/geom';
import { decodePostings } from '../text/trigram';

export const BUILDING_FORMAT_V2 = '2';
export const BUILDING_CELL_DEGREES = 0.0005;
export const BUILDING_CELL_ROW = 262_144;
export const AT_TOLERANCE_M = 3;
export const NEAR_LIMIT = 20;

export const buildingCell = (lon: number, lat: number): number => Math.floor(lat / BUILDING_CELL_DEGREES) * BUILDING_CELL_ROW + Math.floor(lon / BUILDING_CELL_DEGREES);

export type LevelsSource = 'num_floors' | 'osm' | 'height' | 'region';
const SOURCES: LevelsSource[] = ['num_floors', 'osm', 'height', 'region'];

export type BuildingInfo = {
  id: number;
  gid: string;
  center: LngLat;
  areaM2: number;
  levels: number;
  levelsSource: LevelsSource;
  heightM: number | null;
  name: string | null;
  chain: number | null;
  part: number | null;
  side: 'left' | 'right' | null;
  distanceM: number | null;
  along: number | null;
  sequence: number | null;
  secondChain: number | null;
  thirdChain: number | null;
  hood?: number;
  road?: number;
  roadDistanceM?: number;
  knownNumber?: string;
  knownSource?: 'osm' | 'directory';
  predictedNumber?: { value: number; radiusM: number; confidence: number; extrapolated: boolean };
  ring: LngLat[];
};

export type StreetRange = { chain: number; part: number; side: 'left' | 'right'; parity: 'odd' | 'even'; min: number; max: number; predictedMin: number | null; predictedMax: number | null; anchors: number; quality: 1 | 2 | 3 };

export type SettlementInfo = { id: number; name: string; kind: string | null; center: LngLat; buildings: number };

export type EntranceInfo = { id: number; building: number; point: LngLat; kind: string | null; ref: string | null; flats: string | null; unit: string | null };

export type RawBuilding = { id: number; gid: string; lon: number; lat: number; area: number; ring: Uint8Array; levels: number; lsrc: number; height: number | null; name: string | null; chain: number | null; comp: number | null; side: number | null; dist: number | null; s: number | null; seq: number | null; chain2: number | null; chain3: number | null; hood?: number | null; road?: number | null; road_dist?: number | null; num?: string | null; nsrc?: number | null; pnum?: number | null; prad?: number | null; pconf?: number | null; pext?: number | null };

const COLUMNS = 'id, gid, lon, lat, area, ring, levels, lsrc, height, name, chain, comp, side, dist, s, seq, chain2, chain3';

export const toInfo = (r: RawBuilding): BuildingInfo => ({
  id: r.id,
  gid: r.gid,
  center: [r.lon / 1e6, r.lat / 1e6],
  areaM2: r.area,
  levels: r.levels,
  levelsSource: SOURCES[r.lsrc - 1] ?? 'region',
  heightM: r.height,
  name: r.name,
  chain: r.chain,
  part: r.comp,
  side: r.side === null ? null : r.side > 0 ? 'left' : 'right',
  distanceM: r.dist === null ? null : r.dist / 10,
  along: r.s,
  sequence: r.seq,
  secondChain: r.chain2,
  thirdChain: r.chain3,
  ...(r.hood == null ? {} : { hood: r.hood }),
  ...(r.road == null ? {} : { road: r.road, roadDistanceM: (r.road_dist ?? 0) / 10 }),
  ...(r.num == null ? {} : { knownNumber: r.num, knownSource: r.nsrc === 2 ? ('directory' as const) : ('osm' as const) }),
  ...(r.pnum == null ? {} : { predictedNumber: { value: r.pnum, radiusM: r.prad ?? 0, confidence: (r.pconf ?? 0) / 100, extrapolated: r.pext === 1 } }),
  ring: decodeLine(r.ring) as LngLat[],
});

export function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as LngLat;
    const b = ring[j] as LngLat;
    if (a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function edgeDistanceM(point: LngLat, ring: LngLat[]): number {
  let best = Infinity;
  const k = Math.cos((point[1] * Math.PI) / 180) * 111_320;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as LngLat;
    const b = ring[(i + 1) % ring.length] as LngLat;
    const ax = (a[0] - point[0]) * k;
    const ay = (a[1] - point[1]) * 111_320;
    const dx = (b[0] - a[0]) * k;
    const dy = (b[1] - a[1]) * 111_320;
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export function pickAt(candidates: BuildingInfo[], point: LngLat, toleranceM: number): BuildingInfo | null {
  const inside = candidates.filter((b) => pointInRing(point, b.ring)).sort((a, b) => a.areaM2 - b.areaM2 || a.id - b.id);
  if (inside[0]) return inside[0];
  const close = candidates.map((b) => ({ b, d: edgeDistanceM(point, b.ring) })).filter((c) => c.d <= toleranceM).sort((a, b) => a.d - b.d || a.b.id - b.b.id);
  return close[0]?.b ?? null;
}

export function pickNear(found: BuildingInfo[], point: LngLat, radiusM: number, limit: number): { building: BuildingInfo; distanceM: number }[] {
  return found
    .map((building) => ({ building, distanceM: pointInRing(point, building.ring) ? 0 : edgeDistanceM(point, building.ring) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM || a.building.id - b.building.id)
    .slice(0, limit);
}

export type Buildings2 = {
  at(point: LngLat, toleranceM?: number): Promise<BuildingInfo | null>;
  near(point: LngLat, radiusM: number, limit?: number): Promise<{ building: BuildingInfo; distanceM: number }[]>;
  ofStreet(chain: number, side?: 'left' | 'right'): Promise<BuildingInfo[]>;
  trackOf?(chain: number): Promise<BuildingInfo[]>;
  alongStreet(chain: number, part: number, from: number, to: number): Promise<BuildingInfo[]>;
  entrances(building: number): Promise<EntranceInfo[]>;
  road(id: number): Promise<{ id: number; hood: number | null; line: LngLat[] } | null>;
  ranges(chain: number): Promise<StreetRange[]>;
  named(prefix: string, limit?: number): Promise<{ key: string; building: BuildingInfo }[]>;
  settlements(point: LngLat, radiusM: number, limit?: number): Promise<{ settlement: SettlementInfo; distanceM: number }[]>;
};

export const NAMED_LIMIT = 400;

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

const KEPT_BUILDINGS = 4000;
const KEPT_STREETS = 64;

export async function openBuildings2(db: SqlDb): Promise<Buildings2> {
  const meta = new Map((await db.all<{ k: string; v: string }>('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
  if (meta.get('format') !== BUILDING_FORMAT_V2) throw new Error(`desteklenmeyen bina paketi biçimi: ${String(meta.get('format'))}`);

  async function idsIn(cells: number[]): Promise<number[]> {
    if (cells.length === 0) return [];
    const rows = await db.all<{ ids: Uint8Array }>(`SELECT ids FROM building_cell WHERE cell IN (${marks(cells.length)})`, cells);
    return [...new Set(rows.flatMap((r) => decodePostings(r.ids)))];
  }

  let columns: Promise<string> | null = null;
  const columnList = (): Promise<string> => (columns ??= db.all<{ name: string }>("SELECT name FROM pragma_table_info('building') WHERE name IN ('hood', 'road', 'road_dist', 'num', 'nsrc', 'pnum', 'prad', 'pconf', 'pext')").then((r) => [COLUMNS, ...r.map((c) => c.name)].join(', ')));

  let names: Promise<boolean> | null = null;
  const hasNames = (): Promise<boolean> => (names ??= db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'building_name'").then((r) => r.length > 0));

  const kept = new Map<number, BuildingInfo>();
  async function load(ids: number[]): Promise<BuildingInfo[]> {
    if (ids.length === 0) return [];
    const missing = ids.filter((id) => !kept.has(id));
    if (missing.length > 0) {
      if (kept.size + missing.length > KEPT_BUILDINGS) kept.clear();
      for (const row of await db.all<RawBuilding>(`SELECT ${await columnList()} FROM building WHERE id IN (${marks(missing.length)}) ORDER BY id`, missing)) kept.set(row.id, toInfo(row));
    }
    return [...new Set(ids)].sort((a, b) => a - b).flatMap((id) => (kept.has(id) ? [kept.get(id) as BuildingInfo] : []));
  }
  const streets = new Map<string, Promise<BuildingInfo[]>>();
  const tracks = new Map<number, Promise<BuildingInfo[]>>();

  const cellsAround = (point: LngLat, radiusM: number): number[] => {
    const dLat = radiusM / 111_320;
    const dLon = radiusM / (111_320 * Math.cos((point[1] * Math.PI) / 180));
    const cells: number[] = [];
    for (let cy = Math.floor((point[1] - dLat) / BUILDING_CELL_DEGREES); cy <= Math.floor((point[1] + dLat) / BUILDING_CELL_DEGREES); cy++) {
      for (let cx = Math.floor((point[0] - dLon) / BUILDING_CELL_DEGREES); cx <= Math.floor((point[0] + dLon) / BUILDING_CELL_DEGREES); cx++) cells.push(cy * BUILDING_CELL_ROW + cx);
    }
    return cells;
  };

  return {
    async at(point, toleranceM = AT_TOLERANCE_M) {
      return pickAt(await load(await idsIn(cellsAround(point, toleranceM))), point, toleranceM);
    },
    async near(point, radiusM, limit = NEAR_LIMIT) {
      return pickNear(await load(await idsIn(cellsAround(point, radiusM))), point, radiusM, limit);
    },
    async ofStreet(chain, side) {
      const where = side ? 'chain = ? AND side = ?' : 'chain = ?';
      const params = side ? [chain, side === 'left' ? 1 : -1] : [chain];
      const key = `${chain}:${side ?? ''}`;
      let found = streets.get(key);
      if (!found) {
        if (streets.size >= KEPT_STREETS) streets.clear();
        found = columnList().then((list) => db.all<RawBuilding>(`SELECT ${list} FROM building WHERE ${where} ORDER BY side DESC, seq, id`, params)).then((rows) => rows.map(toInfo));
        streets.set(key, found);
        found.catch(() => streets.delete(key));
      }
      return [...(await found)];
    },
    async trackOf(chain) {
      let found = tracks.get(chain);
      if (!found) {
        if (tracks.size >= KEPT_STREETS) tracks.clear();
        found = db
          .all<Pick<RawBuilding, 'id' | 'lon' | 'lat' | 'area' | 'ring' | 'comp' | 'side' | 's' | 'seq'>>('SELECT id, lon, lat, area, ring, comp, side, s, seq FROM building WHERE chain = ? ORDER BY side DESC, seq, id', [chain])
          .then((rows) => rows.map((r) => toInfo({ ...r, gid: '', levels: 0, lsrc: 0, height: null, name: null, chain, dist: null, chain2: null, chain3: null })));
        tracks.set(chain, found);
        found.catch(() => tracks.delete(chain));
      }
      return [...(await found)];
    },
    async alongStreet(chain, part, from, to) {
      return (await db.all<RawBuilding>(`SELECT ${await columnList()} FROM building WHERE chain = ? AND comp = ? AND s BETWEEN ? AND ? ORDER BY side DESC, seq, id`, [chain, part, Math.floor(from), Math.ceil(to)])).map(toInfo);
    },
    async settlements(point, radiusM, limit = NEAR_LIMIT) {
      const dLat = radiusM / 111_320;
      const dLon = radiusM / (111_320 * Math.cos((point[1] * Math.PI) / 180));
      const rows = await db.all<{ id: number; name: string; kind: string | null; lon: number; lat: number; n: number }>('SELECT id, name, kind, lon, lat, n FROM settlement WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? ORDER BY id', [Math.round((point[0] - dLon) * 1e6), Math.round((point[0] + dLon) * 1e6), Math.round((point[1] - dLat) * 1e6), Math.round((point[1] + dLat) * 1e6)]);
      const k = Math.cos((point[1] * Math.PI) / 180) * 111_320;
      return rows
        .map((r) => ({ settlement: { id: r.id, name: r.name, kind: r.kind, center: [r.lon / 1e6, r.lat / 1e6] as LngLat, buildings: r.n }, distanceM: Math.hypot((r.lon / 1e6 - point[0]) * k, (r.lat / 1e6 - point[1]) * 111_320) }))
        .filter((c) => c.distanceM <= radiusM)
        .sort((a, b) => a.distanceM - b.distanceM || a.settlement.id - b.settlement.id)
        .slice(0, limit);
    },
    async named(prefix, limit = NAMED_LIMIT) {
      if (!(await hasNames()) || prefix === '') return [];
      const rows = await db.all<{ key: string; id: number }>('SELECT key, id FROM building_name WHERE key >= ? AND key < ? ORDER BY key, id LIMIT ?', [prefix, `${prefix}\uffff`, Math.max(1, Math.min(limit, NAMED_LIMIT))]);
      const loaded = new Map((await load([...new Set(rows.map((r) => r.id))])).map((b) => [b.id, b]));
      return rows.flatMap((r) => (loaded.has(r.id) ? [{ key: r.key, building: loaded.get(r.id) as BuildingInfo }] : []));
    },
    async entrances(building) {
      const rows = await db.all<{ id: number; building: number; lon: number; lat: number; kind: string | null; ref: string | null; flats: string | null; unit: string | null }>('SELECT id, building, lon, lat, kind, ref, flats, unit FROM entrance WHERE building = ? ORDER BY id', [building]);
      return rows.map((r) => ({ id: r.id, building: r.building, point: [r.lon / 1e6, r.lat / 1e6] as LngLat, kind: r.kind, ref: r.ref, flats: r.flats, unit: r.unit }));
    },
    async ranges(chain) {
      const has = (await db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'street_range'")).length > 0;
      if (!has) return [];
      const rows = await db.all<{ comp: number; side: number; parity: number; min: number; max: number; pmin: number | null; pmax: number | null; anchors: number; quality: number }>('SELECT comp, side, parity, min, max, pmin, pmax, anchors, quality FROM street_range WHERE chain = ? ORDER BY comp, side DESC', [chain]);
      return rows.map((r) => ({ chain, part: r.comp, side: r.side > 0 ? ('left' as const) : ('right' as const), parity: r.parity === 1 ? ('odd' as const) : ('even' as const), min: r.min, max: r.max, predictedMin: r.pmin, predictedMax: r.pmax, anchors: r.anchors, quality: r.quality as 1 | 2 | 3 }));
    },
    async road(id) {
      const has = (await db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'road'")).length > 0;
      if (!has) return null;
      const row = (await db.all<{ id: number; hood: number | null; geom: Uint8Array }>('SELECT id, hood, geom FROM road WHERE id = ?', [id]))[0];
      return row ? { id: row.id, hood: row.hood, line: decodeLine(row.geom) as LngLat[] } : null;
    },
  };
}
