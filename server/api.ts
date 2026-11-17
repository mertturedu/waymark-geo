import { isNearbyGroup, NEARBY_GROUPS } from '../src/core/address/nearby';
import type { Search } from '../src/core/address/search';
import type { Components, Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import type { Lang } from '../src/core/text/types';
import { createHash } from 'node:crypto';
import { createGuard, type ApiKey } from './guard';

export type ApiRequest = { method: string; path: string; query: Record<string, string>; body: unknown; headers: Record<string, string | string[] | undefined>; remote: string };
export type ApiResponse = { status: number; body: unknown; headers?: Record<string, string> };
export type ApiInfo = { sdk: string; data: string; format: string; learned?: string | null };

export const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000] as const;

export type Metrics = { render(open: number, regions: number): string };

export type FlagRule = { percent: number; allow?: readonly string[]; deny?: readonly string[] };
export type Flags = Record<string, FlagRule>;

export const MAX_EVENTS = 50;
export const MAX_EVENT_COUNT = 1000;
const EVENT_NAME = /^[a-z0-9_.]{1,40}$/;

export function bucketOf(flag: string, user: string): number {
  return createHash('sha256').update(`${flag}:${user}`).digest().readUInt32BE(0) % 100;
}

export function flagOn(rule: FlagRule | undefined, flag: string, user: string | undefined): boolean {
  if (!rule) return false;
  if (user !== undefined && rule.deny?.includes(user)) return false;
  if (user !== undefined && rule.allow?.includes(user)) return true;
  if (rule.percent >= 100) return true;
  if (rule.percent <= 0 || user === undefined) return false;
  return bucketOf(flag, user) < rule.percent;
}

export type ApiOptions = { flags?: () => Flags; openHandles?: () => number; search: Search; keys: readonly ApiKey[]; info: ApiInfo | (() => ApiInfo); regions: () => Promise<number>; now?: () => number; log?: (line: string) => void; startedAt?: number };

export const MAX_TEXT = 500;
export const MAX_LIMIT = 20;
export const MAX_BATCH = 100;
export const MAX_CSV_BYTES = 200_000;
export const MAX_RADIUS_M = 5000;
const LANGS: readonly string[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];
const BOX = { west: 25, east: 45.5, south: 35.5, north: 42.5 };

class Bad extends Error {}

function createMetrics(now: () => number, startedAt: number): { record(path: string, status: number, ms: number): void; event(name: string, count: number): void; render(open: number, regions: number): string } {
  const counts = new Map<string, number>();
  const events = new Map<string, number>();
  const buckets = new Map<string, number[]>();
  const sums = new Map<string, number>();
  const label = (path: string): string => (path.startsWith('/v1/lookup/') ? '/v1/lookup/{id}' : path);
  return {
    event(name, count) {
      events.set(name, (events.get(name) ?? 0) + count);
    },
    record(path, status, ms) {
      const p = label(path);
      const key = `${p}\u0000${status}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const histogram = buckets.get(p) ?? Array.from({ length: BUCKETS_MS.length + 1 }, () => 0);
      const at = BUCKETS_MS.findIndex((limit) => ms <= limit);
      histogram[at < 0 ? BUCKETS_MS.length : at] = (histogram[at < 0 ? BUCKETS_MS.length : at] as number) + 1;
      buckets.set(p, histogram);
      sums.set(p, (sums.get(p) ?? 0) + ms);
    },
    render(open, regions) {
      const lines = ['# TYPE geo_requests_total counter'];
      for (const [key, n] of [...counts].sort()) {
        const [p, status] = key.split('\u0000');
        lines.push(`geo_requests_total{path="${p}",status="${status}"} ${n}`);
      }
      lines.push('# TYPE geo_request_duration_ms histogram');
      for (const [p, histogram] of [...buckets].sort()) {
        let run = 0;
        BUCKETS_MS.forEach((limit, i) => {
          run += histogram[i] as number;
          lines.push(`geo_request_duration_ms_bucket{path="${p}",le="${limit}"} ${run}`);
        });
        run += histogram[BUCKETS_MS.length] as number;
        lines.push(`geo_request_duration_ms_bucket{path="${p}",le="+Inf"} ${run}`);
        lines.push(`geo_request_duration_ms_sum{path="${p}"} ${(sums.get(p) ?? 0).toFixed(1)}`);
        lines.push(`geo_request_duration_ms_count{path="${p}"} ${run}`);
      }
      lines.push('# TYPE geo_client_events_total counter');
      for (const [name, n] of [...events].sort()) lines.push(`geo_client_events_total{name="${name}"} ${n}`);
      lines.push('# TYPE geo_open_parts gauge', `geo_open_parts ${open}`, '# TYPE geo_regions gauge', `geo_regions ${regions}`, '# TYPE geo_uptime_seconds gauge', `geo_uptime_seconds ${Math.round((now() - startedAt) / 1000)}`);
      return `${lines.join('\n')}\n`;
    },
  };
}

const fail = (status: number, code: string, message: string, headers?: Record<string, string>): ApiResponse => ({ status, body: { error: { code, message } }, ...(headers ? { headers } : {}) });

function field(request: ApiRequest, name: string): unknown {
  const body = request.body;
  if (body && typeof body === 'object' && !Array.isArray(body) && name in body) return (body as Record<string, unknown>)[name];
  return request.query[name];
}

const text = (request: ApiRequest, ...names: string[]): string => {
  for (const name of names) {
    const value = field(request, name);
    if (typeof value === 'string' && value.trim() !== '') {
      if (value.length > MAX_TEXT) throw new Bad(`${name} en çok ${MAX_TEXT} karakter olabilir`);
      return value;
    }
  }
  throw new Bad(`${names[0]} gerekli`);
};

const optionalText = (request: ApiRequest, name: string): string | undefined => {
  const value = field(request, name);
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 100) throw new Bad(`${name} geçersiz`);
  return value;
};

const number = (request: ApiRequest, name: string, min: number, max: number): number | undefined => {
  const value = field(request, name);
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Bad(`${name} ${min} ile ${max} arasında olmalı`);
  return parsed;
};

const limit = (request: ApiRequest): number | undefined => {
  const value = number(request, 'limit', 1, MAX_LIMIT);
  return value === undefined ? undefined : Math.floor(value);
};

const language = (request: ApiRequest): Lang | undefined => {
  const value = optionalText(request, 'language');
  if (value === undefined) return undefined;
  if (!LANGS.includes(value)) throw new Bad(`language ${LANGS.join(', ')} olmalı`);
  return value as Lang;
};

const point = (request: ApiRequest, lngName: string, latName: string): LngLat | undefined => {
  const lng = number(request, lngName, BOX.west, BOX.east);
  const lat = number(request, latName, BOX.south, BOX.north);
  if (lng === undefined && lat === undefined) return undefined;
  if (lng === undefined || lat === undefined) throw new Bad(`${lngName} ve ${latName} birlikte verilmeli`);
  return [lng, lat];
};

const near = (request: ApiRequest): LngLat | undefined => point(request, 'nearLng', 'nearLat');

const PRECISIONS = ['address', 'interpolated', 'street', 'neighbourhood', 'district', 'province', 'poi'];
const COMPONENT_KEYS = ['province', 'district', 'neighbourhood', 'street', 'houseNumber', 'postcode', 'poiName'] as const;

function components(value: unknown): Components {
  if (!value || typeof value !== 'object') return {};
  const out: Components = {};
  for (const key of COMPONENT_KEYS) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === 'string' && item.length <= 200) out[key] = item;
  }
  return out;
}

function placeOf(request: ApiRequest): Place {
  const value = field(request, 'place');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Bad('place gerekli');
  const raw = value as Record<string, unknown>;
  const at = raw.coordinate;
  if (typeof raw.id !== 'string' || raw.id.length > 80 || typeof raw.region !== 'string' || raw.region.length > 4) throw new Bad('place.id ve place.region geçersiz');
  if (typeof raw.precision !== 'string' || !PRECISIONS.includes(raw.precision)) throw new Bad('place.precision geçersiz');
  if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number' && Number.isFinite(n))) throw new Bad('place.coordinate geçersiz');
  return { id: raw.id, label: '', region: raw.region, precision: raw.precision as Place['precision'], components: components(raw.components), ...(raw.local ? { local: components(raw.local) } : {}), coordinate: [at[0] as number, at[1] as number], approximate: true, source: 'derived', confidence: 1 };
}

function searchOptions(request: ApiRequest) {
  const city = optionalText(request, 'city');
  const district = optionalText(request, 'district');
  const at = near(request);
  const count = limit(request);
  const lang = language(request);
  const shapes = field(request, 'geometry');
  return {
    ...(shapes === true || shapes === 'true' ? { geometry: true } : {}),
    ...(city || district ? { hints: { ...(city ? { city } : {}), ...(district ? { district } : {}) } } : {}),
    ...(at ? { near: at } : {}),
    ...(count === undefined ? {} : { limit: count }),
    ...(lang ? { language: lang } : {}),
  };
}

export function createApi(options: ApiOptions): { handle(request: ApiRequest): Promise<ApiResponse> } {
  const { search, info } = options;
  const now = options.now ?? Date.now;
  const guard = createGuard(options.keys, now);
  const startedAt = options.startedAt ?? now();
  const metrics = createMetrics(now, startedAt);

  const route = async (request: ApiRequest): Promise<ApiResponse> => {
    switch (request.path) {
      case '/v1/geocode':
        return { status: 200, body: await search.resolve(text(request, 'q', 'text'), searchOptions(request)) };
      case '/v1/validate':
        return { status: 200, body: await search.validate(text(request, 'q', 'text'), searchOptions(request)) };
      case '/v1/autocomplete': {
        const deep = field(request, 'deep');
        return { status: 200, body: { places: await search.autocomplete(text(request, 'q', 'text'), { ...searchOptions(request), ...(deep === false || deep === 'false' ? { deep: false } : {}) }) } };
      }
      case '/v1/reverse': {
        const at = point(request, 'lng', 'lat');
        if (!at) throw new Bad('lng ve lat gerekli');
        const heading = number(request, 'heading', 0, 360);
        const accuracy = number(request, 'accuracyM', 0, 1000);
        const lang = language(request);
        return { status: 200, body: { place: await search.reverse(at, { ...(heading === undefined ? {} : { heading }), ...(accuracy === undefined ? {} : { accuracyM: accuracy }), ...(lang ? { language: lang } : {}) }) } };
      }
      case '/v1/admin': {
        const result = await search.admin({ ...(optionalText(request, 'province') ? { province: optionalText(request, 'province') as string } : {}), ...(optionalText(request, 'district') ? { district: optionalText(request, 'district') as string } : {}), ...(optionalText(request, 'hood') ? { hood: optionalText(request, 'hood') as string } : {}), ...(optionalText(request, 'street') ? { street: optionalText(request, 'street') as string } : {}), ...(limit(request) === undefined ? {} : { limit: limit(request) as number }) });
        return result ? { status: 200, body: result } : fail(404, 'not_found', 'bu kimlik kurulu bir ilde yok');
      }
      case '/v1/range': {
        const street = optionalText(request, 'street');
        if (!street) throw new Bad('street gerekli');
        const result = await search.admin({ street });
        return result ? { status: 200, body: { ranges: result.ranges ?? [] } } : fail(404, 'not_found', 'bu sokak kurulu bir ilde yok');
      }
      case '/v1/geocode/batch': {
        const queries = field(request, 'queries');
        if (!Array.isArray(queries) || queries.length === 0) throw new Bad('queries gerekli');
        if (queries.length > MAX_BATCH) throw new Bad(`queries en çok ${MAX_BATCH} olabilir`);
        if (!queries.every((q) => typeof q === 'string' && q.trim() !== '' && q.length <= MAX_TEXT)) throw new Bad('her sorgu boş olmayan bir metin olmalı');
        const options = searchOptions(request);
        const results = [];
        for (const q of queries as string[]) results.push(await search.resolve(q, options));
        return { status: 200, body: { results } };
      }
      case '/v1/validate/csv': {
        const csv = field(request, 'csv');
        if (typeof csv !== 'string' || csv.trim() === '') throw new Bad('csv gerekli');
        if (csv.length > MAX_CSV_BYTES) throw new Bad(`csv en çok ${MAX_CSV_BYTES} karakter olabilir`);
        const rows = csv.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
        const header = /^(adres|address)\b/i.test(rows[0] ?? '') ? 1 : 0;
        const body = rows.slice(header);
        if (body.length > MAX_BATCH) throw new Bad(`en çok ${MAX_BATCH} satır doğrulanabilir`);
        const options = searchOptions(request);
        const out = [];
        for (const [index, line] of body.entries()) {
          const address = line.replace(/^"|"$/g, '').slice(0, MAX_TEXT);
          out.push({ row: index + header + 1, address, validation: await search.validate(address, options) });
        }
        return { status: 200, body: { rows: out } };
      }
      case '/v1/flags': {
        const user = optionalText(request, 'user');
        const rules = options.flags?.() ?? {};
        return { status: 200, body: { flags: Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, flagOn(rule, name, user)])) } };
      }
      case '/v1/events': {
        const list = field(request, 'events');
        if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS) throw new Bad(`events 1 ile ${MAX_EVENTS} arasında olmalı`);
        for (const item of list) {
          const entry = item as { name?: unknown; count?: unknown };
          if (typeof entry?.name !== 'string' || !EVENT_NAME.test(entry.name)) throw new Bad('olay adı geçersiz');
          if (typeof entry.count !== 'number' || !Number.isInteger(entry.count) || entry.count < 1 || entry.count > MAX_EVENT_COUNT) throw new Bad('olay sayısı geçersiz');
        }
        for (const entry of list as { name: string; count: number }[]) metrics.event(entry.name, entry.count);
        return { status: 200, body: { accepted: list.length } };
      }
      case '/v1/geometry':
        return { status: 200, body: { shape: await search.geometry(placeOf(request)) } };
      case '/v1/places': {
        const at = point(request, 'lng', 'lat');
        const group = optionalText(request, 'group');
        if (!at) throw new Bad('lng ve lat gerekli');
        if (!group || !isNearbyGroup(group)) throw new Bad(`group ${Object.keys(NEARBY_GROUPS).join(', ')} olmalı`);
        const radius = number(request, 'radiusM', 1, MAX_RADIUS_M);
        const count = limit(request);
        const lang = language(request);
        return { status: 200, body: { hits: await search.nearby({ point: at, group, ...(radius === undefined ? {} : { radiusM: radius }), ...(count === undefined ? {} : { limit: count }), ...(lang ? { language: lang } : {}) }) } };
      }
      default: {
        if (request.path.startsWith('/v1/lookup/')) {
          const id = decodeURIComponent(request.path.slice('/v1/lookup/'.length));
          if (id === '' || id.length > 80) throw new Bad('kimlik geçersiz');
          const place = await search.lookup(id);
          return place ? { status: 200, body: { place } } : fail(404, 'not_found', 'kimlik çözülemedi');
        }
        return fail(404, 'not_found', 'böyle bir uç yok');
      }
    }
  };

  return {
    async handle(request) {
      const started = now();
      const respond = (response: ApiResponse, keyId = '-'): ApiResponse => {
        metrics.record(request.path, response.status, now() - started);
        options.log?.(`${new Date(started).toISOString()} ${request.method} ${request.path} ${response.status} ${now() - started}ms ${keyId}`);
        return response;
      };
      try {
        if (request.path === '/health') return respond({ status: 200, body: { ok: true, regions: await options.regions(), uptimeS: Math.round((now() - startedAt) / 1000) } });
        if (request.path === '/version') return respond({ status: 200, body: typeof info === 'function' ? info() : info });
        if (request.method !== 'GET' && request.method !== 'POST') return respond(fail(405, 'method_not_allowed', 'GET ya da POST kullanın', { allow: 'GET, POST' }));
        const key = guard.authenticate(request.headers);
        if (!key) return respond(guard.failed(request.remote) ? fail(429, 'too_many_failures', 'çok fazla başarısız deneme', { 'retry-after': '60' }) : fail(401, 'unauthorized', 'geçerli bir API anahtarı gerekli'));
        const wait = guard.allow(key.id);
        if (wait > 0) return respond(fail(429, 'rate_limited', 'istek sınırı aşıldı', { 'retry-after': String(wait) }), key.id);
        if (request.path === '/metrics') return respond({ status: 200, body: metrics.render(options.openHandles?.() ?? 0, await options.regions()), headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' } }, key.id);
        return respond(await route(request), key.id);
      } catch (error) {
        if (error instanceof Bad) return respond(fail(400, 'bad_request', error.message));
        return respond(fail(500, 'internal', 'sunucu hatası'));
      }
    },
  };
}
