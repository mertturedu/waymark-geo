import type { LngLat } from '../geo/cells';
import type { ClockPort } from '../packs/ports';
import type { RouteStore } from '../ports';
import type { Borders } from '../region/borders';
import { congestion, regionBusyness } from '../traffic/model';
import { borderSamples, crossingsOf, pickChain, solveChain, type ChainPlace, type Crossing } from './chain';
import { readRoutePackAsync, type RoutePack } from './format';
import { MOTORCYCLE_FACTOR } from './speeds';
import { createPlanner, type Planner } from './planner';
import { UNREACHABLE } from './matrix';
import type { Snap } from './snap';
import { delayDs, trafficLeg } from './traffic';

export type StopFailure = 'no_road' | 'outside_region' | 'disconnected';

export type Warning = { stop: number; code: 'far_snap' };

export type Vehicle = 'car' | 'motorcycle';

export type RouteOptions = { vehicle?: Vehicle; at?: number };

export type TrafficInfo = { index: number; freeFlowS: number; delayS: number; detour: boolean };

export type RouteResult =
  | { ok: true; region: string; regions?: string[]; distanceM: number; durationS: number; approximate: boolean; geometry: LngLat[]; from: LngLat; to: LngLat; warnings: Warning[]; traffic?: TrafficInfo }
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

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

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
        .then(async (bytes) => {
          if (bytes === null) return null;
          try {
            const pack = await readRoutePackAsync(bytes, pause);
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

  const links = new Map<string, boolean>();
  const crossings = new Map<string, Crossing[]>();
  const forget = (region?: string): void => {
    for (const map of [links, crossings] as Map<string, unknown>[]) for (const key of [...map.keys()]) if (region === undefined || key.split(/[|>]/).includes(region)) map.delete(key);
  };

  store.onChange?.((region) => {
    loading.delete(region);
    used.delete(region);
    forget(region);
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
      const timed = options?.at === undefined ? null : trafficLeg(loaded.pack, loaded.planner, a.snap, b.snap, leg, options.at, region);
      const chosen = timed ? timed.leg : leg;
      const factor = factorOf(options);
      const eta = timed ? timed.freeFlowDs + timed.delayDs : chosen.durationDs;
      return {
        ok: true,
        region,
        distanceM: chosen.distanceM,
        durationS: (eta / 10) * factor,
        approximate: options?.vehicle === 'motorcycle',
        geometry: toDegrees(chosen.line),
        from: a.snap.point,
        to: b.snap.point,
        warnings,
        ...(timed && options?.at !== undefined ? { traffic: { index: congestion(options.at), freeFlowS: (timed.freeFlowDs / 10) * factor, delayS: (timed.delayDs / 10) * factor, detour: timed.detour } } : {}),
      };
    }
    if (failures.some((f) => !f.ok && f.code === 'outside_region')) {
      const chained = await chainOnce(from, to, options, opened.choices);
      if (chained !== null) return chained;
    }
    return failures.find((f) => !f.ok && f.code !== 'outside_region') ?? (failures[0] as RouteResult);
  };

  const adjacent = (a: string, b: string): boolean => {
    const key = `${a}|${b}`;
    const known = links.get(key);
    if (known !== undefined) return known;
    const touching = borderSamples(borders, a, b).length > 0;
    links.set(key, touching);
    links.set(`${b}|${a}`, touching);
    return touching;
  };

  const crossingsBetween = (a: ChainPlace, b: ChainPlace): Crossing[] => {
    const key = `${a.region}>${b.region}`;
    let known = crossings.get(key);
    if (!known) {
      known = crossingsOf(a, b, borderSamples(borders, a.region, b.region));
      crossings.set(key, known);
    }
    return known;
  };

  const chainOnce = async (from: LngLat, to: LngLat, options: RouteOptions | undefined, starts: Choice[]): Promise<RouteResult | null> => {
    const installed = await store.installed();
    const ends: Choice[] = [];
    for (const region of await candidates(to)) {
      const loaded = await load(region);
      if (loaded !== null && loaded !== 'damaged' && loaded.planner.snap(to[0], to[1]).ok) ends.push({ region, loaded });
    }
    for (const start of starts) {
      for (const end of ends) {
        if (start.region === end.region) continue;
        await pause();
        const names = pickChain(borders, installed, start.region, end.region, adjacent);
        if (names === null) continue;
        const places: ChainPlace[] = [];
        for (const region of names) {
          const loaded = region === start.region ? start.loaded : region === end.region ? end.loaded : await load(region);
          if (loaded === null || loaded === 'damaged') break;
          places.push({ region, planner: loaded.planner, pack: loaded.pack });
        }
        if (places.length !== names.length) continue;
        const between: Crossing[][] = [];
        for (let i = 1; i < places.length; i++) {
          await pause();
          between.push(crossingsBetween(places[i - 1] as ChainPlace, places[i] as ChainPlace));
        }
        if (between.some((list) => list.length === 0)) continue;
        const a = start.loaded.planner.snap(from[0], from[1]);
        const b = end.loaded.planner.snap(to[0], to[1]);
        if (!a.ok || !b.ok) continue;
        const solved = await solveChain(places, a.snap, b.snap, between, pause);
        if (solved === null) continue;
        const warnings: Warning[] = [...(a.farSnap ? [{ stop: 0, code: 'far_snap' as const }] : []), ...(b.farSnap ? [{ stop: 1, code: 'far_snap' as const }] : [])];
        const at = options?.at;
        const delay = at === undefined ? 0 : solved.legs.reduce((sum, leg, i) => sum + delayDs((places[i] as ChainPlace).pack, leg.arcs, leg.durationDs, at, regionBusyness(leg.region)), 0);
        const factor = factorOf(options);
        return {
          ok: true,
          region: start.region,
          regions: solved.regions,
          distanceM: solved.distanceM,
          durationS: ((solved.durationDs + delay) / 10) * factor,
          approximate: options?.vehicle === 'motorcycle',
          geometry: toDegrees(solved.line),
          from: a.snap.point,
          to: b.snap.point,
          warnings,
          ...(at === undefined ? {} : { traffic: { index: congestion(at), freeFlowS: (solved.durationDs / 10) * factor, delayS: (delay / 10) * factor, detour: false } }),
        };
      }
    }
    return null;
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
      forget(region);
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
