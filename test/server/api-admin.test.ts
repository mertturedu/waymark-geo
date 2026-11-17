import { createApi, MAX_BATCH, type ApiRequest } from '../../server/api';
import { createSearch, type Search } from '../../src/core/address/search';
import type { AdminResult } from '../../src/core/address/admin';
import type { Place } from '../../src/core/address/types';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

let search: Search;
let close: () => Promise<void> = async () => undefined;
const keys = [{ id: 'kargo', secret: 'gizli-bir', rps: 1000 }];

beforeAll(async () => {
  const made = await memoryStore({ '34': await builtPack() });
  close = made.close;
  search = createSearch({ store: made.store, borders: turkeyBorders() });
});
afterAll(async () => close());

const api = () => createApi({ search, keys, info: { sdk: '0.8.0', data: 'd', format: '2' }, regions: async () => 1 });
const ask = (path: string, extra: Partial<ApiRequest> = {}): ApiRequest => ({ method: 'GET', path, query: {}, body: undefined, headers: { 'x-api-key': 'gizli-bir' }, remote: '9.9.9.9', ...extra });
const body = <T>(response: { body: unknown }): T => response.body as T;

describe('gezinme', () => {
  it('ülkeden sokağa iner, her adımda kararlı kimlik verir', async () => {
    const server = api();
    const country = body<AdminResult>(await server.handle(ask('/v1/admin')));
    expect(country.level).toBe('country');
    expect(country.items.find((i) => i.id === '34')).toMatchObject({ installed: true });
    const districts = body<AdminResult>(await server.handle(ask('/v1/admin', { query: { province: '34' } })));
    expect(districts.items.length).toBeGreaterThan(0);
    expect(districts.items[0]?.id).toMatch(/^I34-/);
    const hoods = body<AdminResult>(await server.handle(ask('/v1/admin', { query: { district: districts.items[0]?.id as string } })));
    expect(hoods.level).toBe('district');
    expect(hoods.items.length).toBeGreaterThan(0);
    const streets = body<AdminResult>(await server.handle(ask('/v1/admin', { query: { hood: hoods.items[0]?.id as string } })));
    expect(streets.level).toBe('hood');
    if (streets.items.length > 0) {
      const detail = body<AdminResult>(await server.handle(ask('/v1/admin', { query: { street: streets.items[0]?.id as string } })));
      expect(detail.level).toBe('street');
      expect(Array.isArray(detail.doors)).toBe(true);
    }
  });

  it('tanınmayan kimlik 404, kurulu olmayan il 404 verir', async () => {
    const server = api();
    expect((await server.handle(ask('/v1/admin', { query: { street: 'S99-aaaaaaaaaa' } }))).status).toBe(404);
    expect((await server.handle(ask('/v1/admin', { query: { province: '06' } }))).status).toBe(404);
    expect((await server.handle(ask('/v1/range', { query: {} }))).status).toBe(400);
  });
});

describe('kimlik çözme', () => {
  it('sonuçta sid var, sid ve eski kimlik aynı yeri verir', async () => {
    const server = api();
    const found = body<{ status: string; best?: Place }>(await server.handle(ask('/v1/geocode', { method: 'POST', body: { q: 'bahariye caddesi 14 kadıköy' } })));
    const place = found.best;
    expect(place).toBeDefined();
    expect(place?.sid).toMatch(/^[DIHS]34/);
    if (!place?.sid) return;
    const bySid = body<{ place: Place }>(await server.handle(ask(`/v1/lookup/${place.sid}`)));
    const byLegacy = body<{ place: Place }>(await server.handle(ask(`/v1/lookup/${encodeURIComponent(place.id)}`)));
    expect(bySid.place.id).toBe(place.id);
    expect(byLegacy.place.sid).toBe(place.sid);
    expect((await server.handle(ask('/v1/lookup/D34-n999999999'))).status).toBe(404);
  });
});

describe('toplu uçlar', () => {
  it('toplu geocode sırayla cevaplar ve sınırı korur', async () => {
    const server = api();
    const ok = body<{ results: { status: string }[] }>(await server.handle(ask('/v1/geocode/batch', { method: 'POST', body: { queries: ['bahariye caddesi 14 kadıköy', 'yoktur sokağı 9999'] } })));
    expect(ok.results).toHaveLength(2);
    const many = await server.handle(ask('/v1/geocode/batch', { method: 'POST', body: { queries: Array.from({ length: MAX_BATCH + 1 }, () => 'x') } }));
    expect(many.status).toBe(400);
  });

  it('csv doğrulama başlığı atlar ve satır numarası verir', async () => {
    const server = api();
    const out = body<{ rows: { row: number; address: string }[] }>(await server.handle(ask('/v1/validate/csv', { method: 'POST', body: { csv: 'adres\nbahariye caddesi 14 kadıköy\n"moda caddesi 5 kadıköy"\n' } })));
    expect(out.rows.map((r) => r.row)).toEqual([2, 3]);
    expect(out.rows[1]?.address).toBe('moda caddesi 5 kadıköy');
  });
});

describe('ölçü ucu', () => {
  it('anahtar ister, istek sayısı ve süre dağılımını metin olarak verir', async () => {
    const server = createApi({ search, keys, info: () => ({ sdk: '0.8.0', data: 'd', format: '2', learned: null }), regions: async () => 1, openHandles: () => 3 });
    expect((await server.handle(ask('/metrics', { headers: {} }))).status).toBe(401);
    await server.handle(ask('/v1/geocode', { method: 'POST', body: { q: 'bahariye caddesi 14 kadıköy' } }));
    await server.handle(ask('/v1/lookup/D34-n1'));
    const metrics = await server.handle(ask('/metrics'));
    expect(metrics.status).toBe(200);
    const text = metrics.body as string;
    expect(text).toContain('geo_requests_total{path="/v1/geocode",status="200"} 1');
    expect(text).toContain('geo_requests_total{path="/v1/lookup/{id}",status="404"} 1');
    expect(text).toMatch(/geo_request_duration_ms_bucket\{path="\/v1\/geocode",le="\+Inf"\} 1/);
    expect(text).toContain('geo_open_parts 3');
    expect(((await server.handle(ask('/version', { headers: {} }))).body as { learned: unknown }).learned).toBeNull();
  });
});
