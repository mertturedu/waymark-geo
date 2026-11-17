import type { AutocompleteOptions, NearbyHit, NearbyOptions, ReverseOptions } from './address/search';
import type { Place, PlaceGeometry, ResolveResult, SearchOptions } from './address/types';
import type { Bbox } from './geo/simplify';
import type { AdminQuery, AdminResult } from './address/admin';
import type { StreetRange } from './address/buildings2';
import type { Validation } from './address/validate';
import type { LngLat } from './geo/cells';

export type GeoClientConfig = { baseUrl: string; key: string; fetch?: typeof fetch; timeoutMs?: number; language?: string };

export type ServerError = Error & { status: number; code: string };

export type GeoClient = {
  resolve(input: string, options?: SearchOptions): Promise<ResolveResult>;
  validate(input: string, options?: SearchOptions): Promise<Validation>;
  autocomplete(input: string, options?: Pick<AutocompleteOptions, 'hints' | 'near' | 'limit' | 'language' | 'deep'>): Promise<Place[]>;
  reverse(point: LngLat, options?: Pick<ReverseOptions, 'heading' | 'accuracyM' | 'language'>): Promise<Place | null>;
  nearby(options: NearbyOptions): Promise<NearbyHit[]>;
  geometry(place: Place): Promise<{ geometry: PlaceGeometry | null; bbox: Bbox | null } | null>;
  flags(user?: string): Promise<Record<string, boolean>>;
  sendEvents(events: { name: string; count: number }[]): Promise<void>;
  lookup(id: string): Promise<Place | null>;
  admin(query?: AdminQuery): Promise<AdminResult>;
  range(street: string): Promise<StreetRange[]>;
  resolveMany(inputs: string[], options?: SearchOptions): Promise<ResolveResult[]>;
  validateCsv(csv: string, options?: SearchOptions): Promise<{ rows: { row: number; address: string; validation: Validation }[] }>;
  health(): Promise<{ ok: boolean; regions: number }>;
  version(): Promise<{ sdk: string; data: string; format: string }>;
};

export const DEFAULT_TIMEOUT_MS = 8000;

export const serverError = (status: number, code: string, message: string): ServerError => Object.assign(new Error(message), { status, code });

export function createGeoClient(config: GeoClientConfig): GeoClient {
  const base = config.baseUrl.replace(/\/+$/, '');
  const run = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown>, authed = true): Promise<T> {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    const url = method === 'GET' && Object.keys(clean).length > 0 ? `${base}${path}?${new URLSearchParams(Object.entries(clean).map(([k, v]) => [k, String(v)]))}` : `${base}${path}`;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await run(url, {
        method,
        headers: { ...(authed ? { 'x-api-key': config.key } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
        ...(method === 'POST' ? { body: JSON.stringify(clean) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
      const body = (await response.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!response.ok) throw serverError(response.status, body?.error?.code ?? 'error', body?.error?.message ?? `HTTP ${response.status}`);
      return body as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const language = (options: { language?: string } | undefined): string | undefined => options?.language ?? config.language;
  const hints = (options: SearchOptions | undefined): Record<string, unknown> => ({ city: options?.hints?.city, district: options?.hints?.district, nearLng: options?.near?.[0], nearLat: options?.near?.[1], limit: options?.limit, language: language(options), geometry: options?.geometry === true ? true : undefined });

  return {
    resolve: (input, options) => call('POST', '/v1/geocode', { q: input, ...hints(options) }),
    validate: (input, options) => call('POST', '/v1/validate', { q: input, ...hints(options) }),
    autocomplete: async (input, options) => (await call<{ places: Place[] }>('POST', '/v1/autocomplete', { q: input, ...hints(options), deep: options?.deep === false ? false : undefined })).places,
    reverse: async (point, options) => (await call<{ place: Place | null }>('GET', '/v1/reverse', { lng: point[0], lat: point[1], heading: options?.heading, accuracyM: options?.accuracyM, language: language(options) })).place,
    nearby: async (options) => (await call<{ hits: NearbyHit[] }>('GET', '/v1/places', { lng: options.point[0], lat: options.point[1], group: options.group, radiusM: options.radiusM, limit: options.limit, language: language(options) })).hits,
    geometry: async (place) => (await call<{ shape: { geometry: PlaceGeometry | null; bbox: Bbox | null } | null }>('POST', '/v1/geometry', { place: { id: place.id, region: place.region, precision: place.precision, components: place.components, local: place.local, coordinate: place.coordinate } })).shape,
    flags: async (user) => (await call<{ flags: Record<string, boolean> }>('GET', '/v1/flags', { user })).flags,
    sendEvents: async (events) => {
      await call('POST', '/v1/events', { events });
    },
    lookup: async (id) => {
      try {
        return (await call<{ place: Place }>('GET', `/v1/lookup/${encodeURIComponent(id)}`, {})).place;
      } catch (error) {
        if ((error as ServerError).status === 404) return null;
        throw error;
      }
    },
    admin: (query) => call('GET', '/v1/admin', { ...(query ?? {}) }),
    range: async (street) => (await call<{ ranges: StreetRange[] }>('GET', '/v1/range', { street })).ranges,
    resolveMany: async (inputs, options) => (await call<{ results: ResolveResult[] }>('POST', '/v1/geocode/batch', { queries: inputs, ...hints(options) })).results,
    validateCsv: (csv, options) => call('POST', '/v1/validate/csv', { csv, ...hints(options) }),
    health: () => call('GET', '/health', {}, false),
    version: () => call('GET', '/version', {}, false),
  };
}
