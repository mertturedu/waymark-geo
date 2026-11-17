import type { LngLat } from './geo/cells';
import { createGeoClient, type GeoClient } from './client';
import { createLearnedLayer } from './learned/layer';
import { createNeighbourhoods, type NeighbourhoodSource } from './address/neighbourhoods';
import { createSearch, structuredText, type AutocompleteOptions, type NearbyHit, type NearbyOptions, type ReverseOptions, type Search } from './address/search';
import type { Coverage, HoodLabel } from './address/coverage';
import { entranceWord, formatEntrance } from './address/unit';
import type { Bbox } from './geo/simplify';
import type { Place, PlaceGeometry, ResolveResult, SearchOptions, StructuredQuery } from './address/types';
import type { Validation } from './address/validate';
import { createLearning, type ConfirmInput, type ConfirmResult, type ImportResult, type LearnStats } from './learn';
import type { LearnStore } from './learn/store';
import { createPackManager, type CheckResult, type DownloadOptions, type PackEnv, type RegionStatus } from './packs/manager';
import { CELLULAR_ASK_MB, decideAuto, detectRegion, type AutoDecision, type Connection, type Detected } from './packs/region';
import type { ConnectionKind } from './packs/ports';
import { createManagedRouteStore } from './packs/route-store';
import { createManagedPackStore } from './packs/store';
import type { PartKind } from './packs/state-file';
import type { SqlDb } from './ports';
import type { Borders } from './region/borders';
import { embeddedBorders } from './region/embedded';
import type { ManifestRegion } from './region/manifest';
import { planStops } from './plan/plan';
import type { PlanRequest, PlanResult, StopInput } from './plan/types';
import { directionsOf, type DirectionStep } from './route/directions';
import { createRouter, type MatrixResult, type RouteOptions, type RouteResult } from './route/router';
import type { Lang } from './text/types';

export const SDK_VERSION = '0.8.0';

export type GeoConfig = {
  manifestUrl: string;
  publicKeys: string[];
  sdkVersion?: string;
  language?: Lang | string;
  autoDownload?: 'ask' | 'wifi' | 'always' | 'never';
  cellularAskMb?: number;
  learning?: { enabled: boolean };
  online?: { baseUrl: string; key: string; timeoutMs?: number };
  tiles?: { url: string };
};

export type GeoEnv = PackEnv & {
  opener: (path: string) => Promise<SqlDb>;
  learnStore: LearnStore;
  neighbourhoods?: NeighbourhoodSource;
  borders?: Borders;
  now?: () => number;
  graceMs?: number;
};

export type LearnResult = ConfirmResult | { ok: false; reason: 'disabled' };

export type ToPlace = { toPlace?: Place };

export type PlaceStop = { id: string; place: Place; point?: LngLat; label?: string };

export type PlanInput = Omit<PlanRequest, 'stops'> & { stops: ReadonlyArray<StopInput | PlaceStop> };

export type DirectionsResult = (Extract<RouteResult, { ok: true }> & { steps: DirectionStep[] }) | Extract<RouteResult, { ok: false }>;

export type Geo = {
  regions: {
    detect(point: unknown): Detected;
    suggest(point: unknown, options?: { connection?: Connection }): AutoDecision;
    connection(): Promise<ConnectionKind>;
    onConnection(listener: (kind: ConnectionKind) => void): () => void;
    downloadBytes(id: string, parts?: PartKind[]): number;
    list(): ManifestRegion[];
    installed(): string[];
    status(id: string): RegionStatus;
    download(id: string, options?: DownloadOptions): Promise<void>;
    downloadCountry(options?: Omit<DownloadOptions, 'parts'>): Promise<{ installed: string[]; failed: string[] }>;
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    remove(id: string, parts?: PartKind[]): Promise<void>;
    checkUpdates(options?: { minIntervalMs?: number }): Promise<CheckResult>;
    dismiss(id: string): Promise<void>;
    dismissed(): string[];
    installedFile(id: string, kind: PartKind): string | null;
    baseDir(): string | null;
    missingBaseBytes(): number;
    downloadBase(options?: DownloadOptions): Promise<void>;
    baseReady(): boolean;
    subscribe(listener: () => void): () => void;
  };
  search: {
    resolve(input: string | StructuredQuery, options?: SearchOptions): Promise<ResolveResult>;
    validate(input: string, options?: SearchOptions): Promise<Validation>;
    autocomplete(text: string, options?: AutocompleteOptions): Promise<Place[]>;
    reverse(point: LngLat, options?: ReverseOptions): Promise<Place | null>;
    nearby(options: NearbyOptions): Promise<NearbyHit[]>;
    hoods(language?: Lang): Promise<HoodLabel[]>;
    coverage(point: LngLat): Promise<Coverage | null>;
    warm(plate: string): Promise<boolean>;
    geometry(place: Place): Promise<{ geometry: PlaceGeometry | null; bbox: Bbox | null } | null>;
  };
  route: {
    route(from: LngLat, to: LngLat, options?: RouteOptions & ToPlace): Promise<RouteResult>;
    matrix(points: ReadonlyArray<LngLat>, options?: RouteOptions): Promise<MatrixResult>;
    directions(from: LngLat, to: LngLat, options?: RouteOptions & ToPlace & { language?: Lang }): Promise<DirectionsResult>;
    installed(): Promise<string[]>;
  };
  plan: {
    plan(request: PlanInput): Promise<PlanResult>;
  };
  learn: {
    confirm(input: ConfirmInput): Promise<LearnResult>;
    export(): string[];
    import(lines: string[]): Promise<ImportResult>;
    clear(): Promise<void>;
    stats(): LearnStats;
  };
  dispose(): Promise<void>;
};

const NO_LEARNING: ImportResult = { added: 0, merged: 0, skipped: 0 };

export async function createGeo(config: GeoConfig, env: GeoEnv): Promise<Geo> {
  const autoDownload = config.autoDownload ?? 'always';
  const askMb = config.cellularAskMb ?? CELLULAR_ASK_MB;
  const askBytes = Number.isFinite(askMb) && askMb >= 0 ? askMb * 1024 * 1024 : Number.POSITIVE_INFINITY;
  const BUSY = ['queued', 'downloading', 'verifying'];
  const borders = env.borders ?? embeddedBorders();
  const manager = await createPackManager(env, { manifestUrl: config.manifestUrl, publicKeys: config.publicKeys, sdkVersion: config.sdkVersion ?? SDK_VERSION, autoDownload, ...(config.tiles ? { keepBase: true } : {}) });
  const store = createManagedPackStore({ manager, opener: env.opener, clock: env.clock, ...(env.graceMs !== undefined ? { graceMs: env.graceMs } : {}) });
  const learning = config.learning?.enabled === false ? null : await createLearning({ store: env.learnStore, ...(env.now ? { now: env.now } : {}) });
  const neighbourhoods = env.neighbourhoods ? createNeighbourhoods(env.neighbourhoods) : undefined;
  const search: Search = createSearch({ store, borders, ...(neighbourhoods ? { neighbourhoods } : {}), layers: [...(learning ? [learning.layer] : []), createLearnedLayer(store)], clock: env.clock });
  store.onChange((plate) => search.invalidate(plate));
  const routeStore = createManagedRouteStore({ manager, fs: env.fs });
  const router = createRouter({ store: routeStore, borders, clock: env.clock });

  const withArrivals = async (request: PlanInput): Promise<PlanRequest> => {
    if (!request || !Array.isArray(request.stops)) return request as unknown as PlanRequest;
    const stops: StopInput[] = [];
    for (const stop of request.stops) {
      if (!stop || !('place' in stop)) {
        stops.push(stop as StopInput);
        continue;
      }
      const arrive = await search.arrival(stop.place);
      stops.push({ id: stop.id, point: arrive.entrance ?? arrive.door, ...(stop.label === undefined ? {} : { label: stop.label }), arrive });
    }
    return { ...request, stops };
  };

  const online: GeoClient | null = config.online ? createGeoClient({ ...config.online, ...(config.language ? { language: config.language } : {}) }) : null;
  const orOnline = async <T>(offline: T, missing: (value: T) => boolean, ask: (client: GeoClient) => Promise<T>): Promise<T> => {
    if (!online || !missing(offline)) return offline;
    try {
      return await ask(online);
    } catch {
      return offline;
    }
  };

  const withLanguage = (options: SearchOptions | undefined): SearchOptions => ({ ...(config.language ? { language: config.language as Lang } : {}), ...(options ?? {}) });

  return {
    regions: {
      detect: (point) => detectRegion(borders, point),
      suggest: (point, options) =>
        decideAuto({
          location: point,
          borders,
          installed: manager.installedRegions(),
          dismissed: manager.dismissed(),
          autoDownload,
          busy: manager.regions().map((region) => region.id).filter((id) => BUSY.includes(manager.status(id).state)),
          connection: options?.connection ?? 'wifi',
          bytesOf: (id) => manager.downloadBytes(id),
          cellularAskBytes: askBytes,
        }),
      connection: () => manager.connection(),
      onConnection: (listener) => manager.onConnection(listener),
      downloadBytes: (id, parts) => manager.downloadBytes(id, parts),
      list: () => manager.regions(),
      installed: () => manager.installedRegions(),
      status: (id) => manager.status(id),
      download: (id, options) => manager.download(id, options),
      async downloadCountry(options) {
        const have = new Set(manager.installedRegions());
        const todo = manager.regions().map((region) => region.id).filter((id) => !have.has(id));
        const total = todo.reduce((sum, id) => sum + manager.downloadBytes(id, ['address']), 0);
        const installed: string[] = [];
        const failed: string[] = [];
        let done = 0;
        for (const id of todo) {
          const size = manager.downloadBytes(id, ['address']);
          try {
            await manager.download(id, { ...options, parts: ['address'], onProgress: (bytes) => options?.onProgress?.(done + bytes, total) });
            installed.push(id);
          } catch {
            failed.push(id);
          }
          done += size;
        }
        return { installed, failed };
      },
      pause: (id) => manager.pause(id),
      resume: (id) => manager.resume(id),
      remove: (id, parts) => manager.remove(id, parts),
      checkUpdates: (options) => manager.checkUpdates(options),
      dismiss: (id) => manager.dismiss(id),
      dismissed: () => manager.dismissed(),
      installedFile: (id, kind) => manager.installedFile(id, kind),
      baseDir: () => manager.baseDir(),
      missingBaseBytes: () => manager.missingBaseBytes(),
      downloadBase: (options) => manager.downloadBase(options),
      baseReady: () => manager.baseReady(),
      subscribe: (listener) => manager.subscribe(listener),
    },
    search: {
      resolve: async (input, options) => orOnline(await search.resolve(input, withLanguage(options)), (r) => r.status === 'region_missing', (client) => client.resolve(typeof input === 'string' ? input : structuredText(input), withLanguage(options))),
      validate: async (input, options) => orOnline(await search.validate(input, withLanguage(options)), (v) => v.notes.some((n) => n.code === 'outside_installed_regions'), (client) => client.validate(input, withLanguage(options))),
      autocomplete: async (text, options) => orOnline(await search.autocomplete(text, withLanguage(options)), (list) => list.length === 0, (client) => client.autocomplete(text, withLanguage(options))),
      reverse: async (point, options) => orOnline(await search.reverse(point, withLanguage(options)), (place) => place === null, (client) => client.reverse(point, withLanguage(options))),
      nearby: (options) => search.nearby({ ...(config.language ? { language: config.language as Lang } : {}), ...options }),
      hoods: (language) => search.hoods(undefined, language),
      coverage: (point) => search.coverage(point),
      warm: (plate) => search.warm(plate),
      geometry: (place) => search.geometry(place),
    },
    route: {
      route: async (from, to, options) => {
        const { toPlace, ...routeOptions } = options ?? {};
        return router.route(from, to, toPlace ? { ...routeOptions, arrive: await search.arrival(toPlace) } : routeOptions);
      },
      matrix: (points, options) => router.matrix(points, options),
      directions: async (from, to, options) => {
        const { language: given, toPlace, ...routeOptions } = options ?? {};
        const result = await router.route(from, to, toPlace ? { ...routeOptions, arrive: await search.arrival(toPlace) } : routeOptions);
        if (!result.ok) return result;
        const language = given ?? config.language ?? 'tr';
        const written = toPlace?.unit ? formatEntrance(toPlace.unit, language as Lang) : '';
        const unit = written || (result.arrival?.entranceRef ? entranceWord(result.arrival.entranceRef, language as Lang) : '');
        const note = result.arrival ? { side: result.arrival.side, ...(unit ? { unit } : {}) } : unit ? { side: null, unit } : undefined;
        const steps = await directionsOf(result.geometry, language, async (point) => (await search.reverse(point, { language: language as Lang }))?.components.street ?? null, note);
        return { ...result, steps };
      },
      installed: () => routeStore.installed(),
    },
    plan: {
      plan: async (request) => planStops(await withArrivals(request), { matrix: (points, options) => router.matrix(points, options), route: (from, to, options) => router.route(from, to, options), now: () => env.clock.now() }),
    },
    learn: {
      confirm: async (input) => (learning ? learning.confirm(input) : { ok: false, reason: 'disabled' }),
      export: () => (learning ? learning.exportLines() : []),
      import: async (lines) => (learning ? learning.importLines(lines) : NO_LEARNING),
      clear: async () => {
        await learning?.forget();
      },
      stats: () => learning?.stats() ?? { keys: 0, confirmations: 0, damaged: 0, newer: 0 },
    },
    async dispose() {
      router.invalidate();
      await manager.idle();
      await store.closeAll();
      await env.learnStore.close?.();
    },
  };
}
