import { FLAG, edgeLine, type RoutePack } from './format';

export type Snap = { edge: number; offsetM: number; distanceM: number; point: [number, number] };

export type SnapResult = { ok: true; snap: Snap; farSnap: boolean } | { ok: false; reason: 'no_road' };

const M_PER_DEGREE = 111_195;
const MICRO = 1e6;
const RAD = Math.PI / 180;
const MAX_SNAP_M = 500;
const FAR_SNAP_M = 150;
const AVOID_RADIUS_M = 200;
const MAIN_SLACK_M = 100;
const HEAVY_CLASSES = 4;
const FERRY_CLASS = 14;
const MAX_LAT = 85;
const MAX_LNG = 180;

type Candidate = { edge: number; distanceM: number; offsetM: number; point: [number, number]; heavy: boolean; main: boolean; ferry: boolean };

export function project(line: number[], px: number, py: number, mLon: number, mLat: number): { distanceM: number; along: number; total: number; x: number; y: number } {
  let best = { distanceM: Infinity, along: 0, x: 0, y: 0 };
  let walked = 0;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = ((line[i] as number) - px) * mLon;
    const ay = ((line[i + 1] as number) - py) * mLat;
    const bx = ((line[i + 2] as number) - px) * mLon;
    const by = ((line[i + 3] as number) - py) * mLat;
    const dx = bx - ax;
    const dy = by - ay;
    const squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / squared));
    const away = Math.hypot(ax + dx * t, ay + dy * t);
    const segment = Math.sqrt(squared);
    if (away < best.distanceM) best = { distanceM: away, along: walked + segment * t, x: px + (ax + dx * t) / mLon, y: py + (ay + dy * t) / mLat };
    walked += segment;
  }
  return { ...best, total: walked };
}

export function snapPoint(pack: RoutePack, lng: number, lat: number): SnapResult {
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > MAX_LAT || Math.abs(lng) > MAX_LNG) return { ok: false, reason: 'no_road' };
  const px = Math.round(lng * MICRO);
  const py = Math.round(lat * MICRO);
  const mLat = M_PER_DEGREE / MICRO;
  const mLon = mLat * Math.cos(lat * RAD);
  const g = pack.grid;
  const cellLonM = g.cell * mLon;
  const cellLatM = g.cell * mLat;
  const cellM = Math.min(cellLonM, cellLatM);
  const gx = (px - g.originLon) / g.cell;
  const gy = (py - g.originLat) / g.cell;
  const cx = Math.floor(gx);
  const cy = Math.floor(gy);
  const fx = gx - cx;
  const fy = gy - cy;
  const margin = Math.min(fx * cellLonM, (1 - fx) * cellLonM, fy * cellLatM, (1 - fy) * cellLatM);
  const maxRing = Math.ceil(MAX_SNAP_M / cellM) + 1;

  const seen = new Set<number>();
  const found: Candidate[] = [];
  let ring = -1;

  const visit = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) return;
    const cell = y * g.cols + x;
    for (let k = g.first[cell] as number; k < (g.first[cell + 1] as number); k++) {
      const edge = g.edges[k] as number;
      if (seen.has(edge)) continue;
      seen.add(edge);
      const hit = project(edgeLine(pack, edge), px, py, mLon, mLat);
      if (hit.distanceM > MAX_SNAP_M) continue;
      const flags = pack.edges.flags[edge] as number;
      const length = pack.edges.length[edge] as number;
      found.push({
        edge,
        distanceM: hit.distanceM,
        offsetM: hit.total === 0 ? 0 : (hit.along / hit.total) * length,
        point: [hit.x / MICRO, hit.y / MICRO],
        heavy: flags >> FLAG.classShift < HEAVY_CLASSES,
        ferry: flags >> FLAG.classShift === FERRY_CLASS,
        main: (flags & FLAG.main) !== 0,
      });
    }
  };
  const scanRing = (r: number): void => {
    if (r === 0) {
      visit(cx, cy);
      return;
    }
    for (let d = -r; d <= r; d++) {
      visit(cx + d, cy - r);
      visit(cx + d, cy + r);
      if (d > -r && d < r) {
        visit(cx - r, cy + d);
        visit(cx + r, cy + d);
      }
    }
  };
  const reach = (radius: number): void => {
    while (ring < maxRing && (ring < 0 ? 0 : ring * cellM + margin) < radius) scanRing(++ring);
  };
  const nearest = (list: Candidate[]): Candidate | undefined => list.reduce<Candidate | undefined>((best, c) => (best === undefined || c.distanceM < best.distanceM || (c.distanceM === best.distanceM && c.edge < best.edge) ? c : best), undefined);

  for (;;) {
    const best = nearest(found);
    if (ring >= maxRing || (best !== undefined && best.distanceM <= (ring < 0 ? 0 : ring * cellM + margin))) break;
    scanRing(++ring);
  }
  let chosen = nearest(found);
  if (chosen === undefined) return { ok: false, reason: 'no_road' };
  if (chosen.ferry) {
    reach(MAX_SNAP_M);
    chosen = nearest(found.filter((c) => !c.ferry)) ?? chosen;
  }
  if (chosen.heavy) {
    reach(AVOID_RADIUS_M);
    chosen = nearest(found.filter((c) => !c.heavy && c.distanceM <= AVOID_RADIUS_M)) ?? chosen;
  }
  if (!chosen.main) {
    reach(chosen.distanceM + MAIN_SLACK_M);
    const limit = chosen.distanceM + MAIN_SLACK_M;
    chosen = nearest(found.filter((c) => c.main && !c.heavy && c.distanceM <= limit)) ?? chosen;
  }
  const snap: Snap = { edge: chosen.edge, offsetM: chosen.offsetM, distanceM: chosen.distanceM, point: chosen.point };
  return { ok: true, snap, farSnap: chosen.distanceM > FAR_SNAP_M };
}
