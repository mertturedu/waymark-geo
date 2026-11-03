import type { LngLat } from './geo/cells';
import { createSearch, type NearbyHit, type NearbyOptions, type Search } from './address/search';
import type { Coverage, HoodLabel } from './address/coverage';
import type { Place, ResolveResult, SearchOptions, StructuredQuery } from './address/types';
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
import type { PlanRequest, PlanResult } from './plan/types';
import { directionsOf, type DirectionStep } from './route/directions';
import { createRouter, type MatrixResult, type RouteOptions, type RouteResult } from './route/router';
import type { Lang } from './text/types';

export const SDK_VERSION = '0.5.0';

export type GeoConfig = {
  manifestUrl: string;
  publicKeys: string[];
  sdkVersion?: string;
  language?: Lang | string;
  autoDownload?: 'ask' | 'wifi' | 'always' | 'never';
  cellularAskMb?: number;
  learning?: { enabled: boolean };
};

export type GeoEnv = PackEnv & {
  opener: (path: string) => Promise<SqlDb>;
  learnStore: LearnStore;
  borders?: Borders;
  now?: () => number;
  graceMs?: number;
};

export type LearnResult = ConfirmResult | { ok: false; reason: 'disabled' };

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
    pause(id: string): Promise<void>;
    resume(id: string): Promise<void>;
    remove(id: string, parts?: PartKind[]): Promise<void>;
    checkUpdates(options?: { minIntervalMs?: number }): Promise<CheckResult>;
    dismiss(id: string): Promise<void>;
    dismissed(): string[];
    installedFile(id: string, kind: PartKind): string | null;
    baseDir(): string | null;
    missingBaseBytes(): number;
    subscribe(listener: () => void): () => void;
  };
  search: {
    resolve(input: string | StructuredQuery, options?: SearchOptions): Promise<ResolveResult>;
    autocomplete(text: string, options?: SearchOptions): Promise<Place[]>;
    reverse(point: LngLat, options?: { language?: Lang }): Promise<Place | null>;
    nearby(options: NearbyOptions): Promise<NearbyHit[]>;
    hoods(language?: Lang): Promise<HoodLabel[]>;
    coverage(point: LngLat): Promise<Coverage | null>;
  };
  route: {
    route(from: LngLat, to: LngLat, options?: RouteOptions): Promise<RouteResult>;
    matrix(points: ReadonlyArray<LngLat>, options?: RouteOptions): Promise<MatrixResult>;
    directions(from: LngLat, to: LngLat, options?: RouteOptions & { language?: Lang }): Promise<DirectionsResult>;
    installed(): Promise<string[]>;
  };
  plan: {
    plan(request: PlanRequest): Promise<PlanResult>;
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
  const manager = await createPackManager(env, { manifestUrl: config.manifestUrl, publicKeys: config.publicKeys, sdkVersion: config.sdkVersion ?? SDK_VERSION, autoDownload });
  const store = createManagedPackStore({ manager, opener: env.opener, clock: env.clock, ...(env.graceMs !== undefined ? { graceMs: env.graceMs } : {}) });
  const learning = config.learning?.enabled === false ? null : await createLearning({ store: env.learnStore, ...(env.now ? { now: env.now } : {}) });
  const search: Search = createSearch({ store, borders, layers: learning ? [learning.layer] : [], clock: env.clock });
  store.onChange((plate) => search.invalidate(plate));
  const routeStore = createManagedRouteStore({ manager, fs: env.fs });
  const router = createRouter({ store: routeStore, borders, clock: env.clock });

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
      pause: (id) => manager.pause(id),
      resume: (id) => manager.resume(id),
      remove: (id, parts) => manager.remove(id, parts),
      checkUpdates: (options) => manager.checkUpdates(options),
      dismiss: (id) => manager.dismiss(id),
      dismissed: () => manager.dismissed(),
      installedFile: (id, kind) => manager.installedFile(id, kind),
      baseDir: () => manager.baseDir(),
      missingBaseBytes: () => manager.missingBaseBytes(),
      subscribe: (listener) => manager.subscribe(listener),
    },
    search: {
      resolve: (input, options) => search.resolve(input, withLanguage(options)),
      autocomplete: (text, options) => search.autocomplete(text, withLanguage(options)),
      reverse: (point, options) => search.reverse(point, withLanguage(options)),
      nearby: (options) => search.nearby({ ...(config.language ? { language: config.language as Lang } : {}), ...options }),
      hoods: (language) => search.hoods(undefined, language),
      coverage: (point) => search.coverage(point),
    },
    route: {
      route: (from, to, options) => router.route(from, to, options),
      matrix: (points, options) => router.matrix(points, options),
      directions: async (from, to, options) => {
        const { language: given, ...routeOptions } = options ?? {};
        const result = await router.route(from, to, routeOptions);
        if (!result.ok) return result;
        const language = given ?? config.language ?? 'tr';
        const steps = await directionsOf(result.geometry, language, async (point) => (await search.reverse(point, { language: language as Lang }))?.components.street ?? null);
        return { ...result, steps };
      },
      installed: () => routeStore.installed(),
    },
    plan: {
      plan: (request) => planStops(request, { matrix: (points, options) => router.matrix(points, options), route: (from, to, options) => router.route(from, to, options), now: () => env.clock.now() }),
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
