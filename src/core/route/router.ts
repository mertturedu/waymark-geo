import type { LngLat } from '../geo/cells';
import type { ClockPort } from '../packs/ports';
import type { RouteStore } from '../ports';
import type { Borders } from '../region/borders';
import { readRoutePack, type RoutePack } from './format';
import { MOTORCYCLE_FACTOR } from './speeds';
import { createPlanner, type Planner } from './planner';
import { UNREACHABLE } from './matrix';
import type { Snap } from './snap';

export type StopFailure = 'no_road' | 'outside_region' | 'disconnected';

export type Warning = { stop: number; code: 'far_snap' };

export type Vehicle = 'car' | 'motorcycle';

export type RouteOptions = { vehicle?: Vehicle };

export type RouteResult =
  | { ok: true; region: string; distanceM: number; durationS: number; approximate: boolean; geometry: LngLat[]; from: LngLat; to: LngLat; warnings: Warning[] }
  | { ok: false; code: 'START_OUTSIDE_REGION' | 'PACK_DAMAGED' | StopFailure; stop?: number };

export type StopState = { ok: true; point: LngLat; warnings: Warning[] } | { ok: false; reason: StopFailure };

export type MatrixResult =
  | { ok: true; region: string; approximate: boolean; stops: StopState[]; durationS: (number | null)[][]; distanceM: (number | null)[][] }
  | { ok: false; code: 'START_OUTSIDE_REGION' | 'PACK_DAMAGED' | StopFailure };

export type Router = {
  route(from: LngLat, to: LngLat, options?: RouteOptions): Promise<RouteResult>;
  matrix(points: ReadonlyArray<LngLat>, options?: RouteOptions): Promise<MatrixResult>;
  invalidate(region?: string): void;
};

export type RouterConfig = { store: RouteStore; borders: Borders; clock?: ClockPort; idleMs?: number };

const COVER_M = 10_000;
const DEFAULT_IDLE_MS = 60_000;

type Loaded = { pack: RoutePack; planner: Planner };

export function createRouter(config: RouterConfig): Router {
  const { store, borders, clock } = config;
  const idleMs = config.idleMs ?? DEFAULT_IDLE_MS;
  const loading = new Map<string, Promise<Loaded | null | 'damaged'>>();
  const used = new Map<string, number>();

  const sleeping = new Set<string>();
  const watch = (region: string): void => {
    if (!clock) return;
    used.set(region, clock.now());
    if (sleeping.has(region)) return;
    sleeping.add(region);
    const wait = (ms: number): void => {
      void clock.sleep(ms).then(() => {
        const idle = clock.now() - (used.get(region) ?? 0);
        if (idle >= idleMs) {
          sleeping.delete(region);
          used.delete(region);
          loading.delete(region);
        } else wait(idleMs - idle);
      });
    };
    wait(idleMs);
  };

  const load = (region: string): Promise<Loaded | null | 'damaged'> => {
    let pending = loading.get(region);
    if (!pending) {
      pending = store
        .read(region)
        .then((bytes) => {
          if (bytes === null) return null;
          try {
            const pack = readRoutePack(bytes);
            return { pack, planner: createPlanner(pack) };
          } catch {
            return 'damaged' as const;
          }
        })
        .catch(() => null);
      loading.set(region, pending);
      void pending.then((value) => {
        if (value === null && loading.get(region) === pending) loading.delete(region);
      });
    }
    watch(region);
    return pending;
  };

  store.onChange?.((region) => {
    loading.delete(region);
    used.delete(region);
  });

  const covers = (region: string, point: LngLat): boolean => borders.provinceAt(point[0], point[1]) === region || borders.nearBorder(point[0], point[1], COVER_M).includes(region);

  const candidates = async (point: LngLat): Promise<string[]> => {
    const installed = new Set(await store.installed());
    const own = borders.provinceAt(point[0], point[1]);
    return [...(own ? [own] : []), ...borders.nearBorder(point[0], point[1], COVER_M)].filter((id) => installed.has(id));
  };

  const classify = (loaded: Loaded, region: string, point: LngLat): { ok: true; snap: Snap; far: boolean } | { ok: false; reason: StopFailure } => {
    const got = loaded.planner.snap(point[0], point[1]);
    if (got.ok) return { ok: true, snap: got.snap, far: got.farSnap };
    return { ok: false, reason: covers(region, point) ? 'no_road' : 'outside_region' };
  };

  type Choice = { region: string; loaded: Loaded };

  const open = async (start: LngLat): Promise<{ choices: Choice[] } | { fail: 'START_OUTSIDE_REGION' | 'PACK_DAMAGED' }> => {
    const options = await candidates(start);
    if (options.length === 0) return { fail: 'START_OUTSIDE_REGION' };
    let damaged = false;
    const choices: Choice[] = [];
    for (const region of options) {
      const loaded = await load(region);
      if (loaded === 'damaged') {
        damaged = true;
        continue;
      }
      if (loaded !== null && loaded.planner.snap(start[0], start[1]).ok) choices.push({ region, loaded });
    }
    return choices.length > 0 ? { choices } : { fail: damaged ? 'PACK_DAMAGED' : 'START_OUTSIDE_REGION' };
  };

  const toDegrees = (line: number[]): LngLat[] => {
    const out: LngLat[] = [];
    for (let i = 0; i + 1 < line.length; i += 2) out.push([(line[i] as number) / 1e6, (line[i + 1] as number) / 1e6]);
    return out;
  };

  const factorOf = (options: RouteOptions | undefined): number => (options?.vehicle === 'motorcycle' ? MOTORCYCLE_FACTOR : 1);

  const routeOnce = async (from: LngLat, to: LngLat, options?: RouteOptions): Promise<RouteResult> => {
    const opened = await open(from);
    if ('fail' in opened) return { ok: false, code: opened.fail };
    const failures: RouteResult[] = [];
    for (const { region, loaded } of opened.choices) {
      const a = classify(loaded, region, from);
      const b = classify(loaded, region, to);
      if (!a.ok || !b.ok) {
        failures.push({ ok: false, code: b.ok ? (a as { reason: StopFailure }).reason : b.reason, stop: b.ok ? 0 : 1 });
        continue;
      }
      const leg = loaded.planner.route(a.snap, b.snap);
      if (leg === null) {
        failures.push({ ok: false, code: 'disconnected', stop: 1 });
        continue;
      }
      const warnings: Warning[] = [...(a.far ? [{ stop: 0, code: 'far_snap' as const }] : []), ...(b.far ? [{ stop: 1, code: 'far_snap' as const }] : [])];
      return { ok: true, region, distanceM: leg.distanceM, durationS: (leg.durationDs / 10) * factorOf(options), approximate: options?.vehicle === 'motorcycle', geometry: toDegrees(leg.line), from: a.snap.point, to: b.snap.point, warnings };
    }
    return failures.find((f) => !f.ok && f.code !== 'outside_region') ?? (failures[0] as RouteResult);
  };

  const matrixOnce = async (points: ReadonlyArray<LngLat>, options?: RouteOptions): Promise<MatrixResult> => {
    const first = points[0];
    if (first === undefined) return { ok: false, code: 'START_OUTSIDE_REGION' };
    const opened = await open(first);
    if ('fail' in opened) return { ok: false, code: opened.fail };
    const classified = opened.choices.map(({ region, loaded }) => ({ region, loaded, found: points.map((point) => classify(loaded, region, point)) }));
    const best = classified.reduce((top, c) => (c.found.filter((f) => f.ok).length > top.found.filter((f) => f.ok).length ? c : top));
    const { region, loaded } = best;
    const stops: StopState[] = [];
    const snaps: Snap[] = [];
    const index: number[] = [];
    best.found.forEach((got, i) => {
      if (!got.ok) {
        stops.push({ ok: false, reason: got.reason });
        return;
      }
      stops.push({ ok: true, point: got.snap.point, warnings: got.far ? [{ stop: i, code: 'far_snap' }] : [] });
      index.push(i);
      snaps.push(got.snap);
    });
    const table = loaded.planner.matrix(snaps, snaps);
    const duration: (number | null)[][] = points.map(() => points.map(() => null));
    const distance: (number | null)[][] = points.map(() => points.map(() => null));
    index.forEach((i, row) => {
      index.forEach((j, col) => {
        const w = table.w[row * snaps.length + col] as number;
        if (w === UNREACHABLE) return;
        (duration[i] as (number | null)[])[j] = (w / 10) * factorOf(options);
        (distance[i] as (number | null)[])[j] = table.len[row * snaps.length + col] as number;
      });
    });
    index.forEach((i, col) => {
      if (col === 0 || table.w[col] !== UNREACHABLE) return;
      stops[i] = { ok: false, reason: 'disconnected' };
      for (let k = 0; k < points.length; k++) {
        (duration[i] as (number | null)[])[k] = null;
        (distance[i] as (number | null)[])[k] = null;
        (duration[k] as (number | null)[])[i] = null;
        (distance[k] as (number | null)[])[i] = null;
      }
    });
    return { ok: true, region, approximate: options?.vehicle === 'motorcycle', stops, durationS: duration, distanceM: distance };
  };

  return {
    async route(from, to, options) {
      try {
        return await routeOnce(from, to, options);
      } catch {
        return { ok: false, code: 'PACK_DAMAGED' };
      }
    },

    async matrix(points, options) {
      try {
        return await matrixOnce(points, options);
      } catch {
        return { ok: false, code: 'PACK_DAMAGED' };
      }
    },

    invalidate(region) {
      if (region === undefined) {
        loading.clear();
        used.clear();
      } else {
        loading.delete(region);
        used.delete(region);
      }
    },
  };
}
