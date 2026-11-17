import { createApi, MAX_LIMIT, MAX_TEXT, type ApiRequest } from '../../server/api';
import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

let search: Search;
let close: () => Promise<void> = async () => undefined;
const lines: string[] = [];
const keys = [{ id: 'kargo', secret: 'gizli-bir', rps: 1000 }];

beforeAll(async () => {
  const made = await memoryStore({ '34': await builtPack() });
  close = made.close;
  search = createSearch({ store: made.store, borders: turkeyBorders() });
});
afterAll(async () => close());

const make = (rest: Partial<Parameters<typeof createApi>[0]> = {}) => createApi({ search, keys, info: { sdk: '0.8.0', data: 'd', format: '2' }, regions: async () => 1, log: (line) => lines.push(line), ...rest });
const ask = (path: string, extra: Partial<ApiRequest> = {}): ApiRequest => ({ method: 'POST', path, query: {}, body: undefined, headers: { 'x-api-key': 'gizli-bir' }, remote: '9.9.9.9', ...extra });
const body = <T>(response: { body: unknown }): T => response.body as T;

describe('the open endpoints', () => {
  it('answer health and version without a key', async () => {
    const api = make();
    expect(await api.handle(ask('/health', { method: 'GET', headers: {} }))).toMatchObject({ status: 200, body: { ok: true, regions: 1 } });
    expect(await api.handle(ask('/version', { method: 'GET', headers: {} }))).toEqual({ status: 200, body: { sdk: '0.8.0', data: 'd', format: '2' } });
  });
});

describe('the guarded endpoints', () => {
  it('say who may ask, how fast and what is not allowed', async () => {
    const api = make();
    expect((await api.handle(ask('/v1/geocode', { headers: {} }))).status).toBe(401);
    expect((await api.handle(ask('/v1/geocode', { method: 'DELETE' }))).status).toBe(405);
    expect((await api.handle(ask('/v1/yok', { body: { q: 'x' } }))).status).toBe(404);
    const slow = make({ keys: [{ id: 'k', secret: 'gizli-bir', rps: 1 }] });
    await slow.handle(ask('/v1/geocode', { body: { q: 'bahariye caddesi 14' } }));
    await slow.handle(ask('/v1/geocode', { body: { q: 'bahariye caddesi 14' } }));
    const limited = await slow.handle(ask('/v1/geocode', { body: { q: 'bahariye caddesi 14' } }));
    expect(limited.status).toBe(429);
    expect(limited.headers?.['retry-after']).toBeDefined();
    const locked = make();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await locked.handle(ask('/v1/geocode', { headers: { 'x-api-key': 'yanlis' }, remote: '7.7.7.7' }))).status;
    expect(last).toBe(429);
  });

  it('geocodes, validates and completes text from a body or from the query', async () => {
    const api = make();
    const found = await api.handle(ask('/v1/geocode', { body: { q: 'Bahariye Caddesi 14 Kadıköy', city: 'İstanbul', limit: 3 } }));
    expect(found.status).toBe(200);
    expect(body<{ status: string }>(found).status).toMatch(/resolved|ambiguous/);
    expect(await search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' }, limit: 3 })).toEqual(body(found));
    const byQuery = await api.handle(ask('/v1/geocode', { method: 'GET', query: { text: 'Bahariye Caddesi 14 Kadıköy', city: 'İstanbul', limit: '3', nearLng: '28.6', nearLat: '40.7', language: 'en', district: 'Kadıköy' } }));
    expect(byQuery.status).toBe(200);
    expect(body<{ status: string }>(await api.handle(ask('/v1/validate', { body: { q: 'Bahariye Caddesi 14 Kadıköy İstanbul' } }))).status).toMatch(/ok|incomplete|conflict|not_found/);
    const completed = await api.handle(ask('/v1/autocomplete', { body: { q: 'bahariye', deep: false } }));
    expect(body<{ places: unknown[] }>(completed).places.length).toBeGreaterThan(0);
    expect(body<{ places: unknown[] }>(await api.handle(ask('/v1/autocomplete', { body: { q: 'bahariye', deep: 'false' } }))).places.length).toBeGreaterThan(0);
  });

  it('finds the place at a point and the places near it', async () => {
    const api = make();
    const here = await api.handle(ask('/v1/reverse', { method: 'GET', query: { lng: '28.6', lat: '40.7', heading: '90', accuracyM: '10', language: 'tr' } }));
    expect(here.status).toBe(200);
    expect(body<{ place: unknown }>(here)).toHaveProperty('place');
    const near = await api.handle(ask('/v1/places', { method: 'GET', query: { lng: '28.645', lat: '40.745', group: 'pharmacy', radiusM: '2000', limit: '3', language: 'tr' } }));
    expect(body<{ hits: { place: { components: { poiName: string } } }[] }>(near).hits[0]?.place.components.poiName).toBe('Merkez Eczanesi');
  });

  it('gives the shape of a place it is handed and refuses a malformed place', async () => {
    const api = make();
    const found = await api.handle(ask('/v1/geocode', { body: { q: 'Bahariye Caddesi Kadıköy İstanbul', geometry: true } }));
    const street = body<{ best?: { id: string; region: string; precision: string; components: object; coordinate: number[]; geometry?: { kind: string } }; candidates?: { id: string; region: string; precision: string; components: object; coordinate: number[]; geometry?: { kind: string } }[] }>(found);
    const top = street.best ?? street.candidates?.[0];
    expect(top?.geometry?.kind).toBe('street');
    const shape = await api.handle(ask('/v1/geometry', { body: { place: { id: top?.id, region: top?.region, precision: top?.precision, components: { ...top?.components, ignored: 1, long: 'x' }, local: top?.components, coordinate: top?.coordinate } } }));
    expect(body<{ shape: { geometry: { kind: string } } }>(shape).shape.geometry.kind).toBe('street');
    const bad = async (place: unknown) => (await api.handle(ask('/v1/geometry', { body: { place } }))).status;
    expect(await bad(undefined)).toBe(400);
    expect(await bad([])).toBe(400);
    expect(await bad({ id: 5, region: '34', precision: 'street', coordinate: [29, 41] })).toBe(400);
    expect(await bad({ id: '34:s:1:0', region: '34', precision: 'yok', coordinate: [29, 41] })).toBe(400);
    expect(await bad({ id: '34:s:1:0', region: '34', precision: 'street', coordinate: [29] })).toBe(400);
    expect(await bad({ id: '34:s:1:0', region: '34', precision: 'street', coordinate: [29, 41], components: 'x' })).toBe(200);
  });

  it('refuses what it cannot understand, without echoing it', async () => {
    const api = make();
    const bad = async (path: string, request: Partial<ApiRequest>): Promise<string> => {
      const response = await api.handle(ask(path, request));
      expect(response.status).toBe(400);
      return JSON.stringify(response.body);
    };
    await bad('/v1/geocode', { body: {} });
    await bad('/v1/geocode', { body: { q: 'x'.repeat(MAX_TEXT + 1) } });
    await bad('/v1/geocode', { body: { q: 'a', limit: MAX_LIMIT + 1 } });
    await bad('/v1/geocode', { body: { q: 'a', language: 'xx' } });
    await bad('/v1/geocode', { body: { q: 'a', nearLng: 29 } });
    await bad('/v1/geocode', { body: { q: 'a', city: 5 } });
    await bad('/v1/geocode', { body: { q: 'a', nearLng: 'abc', nearLat: 40 } });
    await bad('/v1/reverse', { method: 'GET', query: {} });
    await bad('/v1/reverse', { method: 'GET', query: { lng: '0', lat: '0' } });
    await bad('/v1/places', { method: 'GET', query: { lng: '29', lat: '41', group: 'yok' } });
    await bad('/v1/places', { method: 'GET', query: { group: 'pharmacy' } });
    const secret = await bad('/v1/geocode', { body: { q: 'a', language: '05321234567' } });
    expect(secret).not.toContain('05321234567');
  });

  it('hides a failure inside and keeps the text of a query out of the log', async () => {
    const broken = { ...search, resolve: async () => { throw new Error('içeride 05321234567 patladı'); } } as unknown as Search;
    const response = await make({ search: broken }).handle(ask('/v1/geocode', { body: { q: 'Ayşe Hanım Sokak 5 05321234567' } }));
    expect(response).toMatchObject({ status: 500, body: { error: { code: 'internal' } } });
    expect(JSON.stringify(response.body)).not.toContain('05321234567');
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.join('\n')).not.toMatch(/Ayşe|05321234567|bahariye|Bahariye/i);
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.* (GET|POST|DELETE) \/\S+ \d{3} \d+ms \S+$/);
  });
});
