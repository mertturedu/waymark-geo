import { bucketOf, createApi, flagOn, type ApiRequest, type Flags } from '../../server/api';
import { parseFlags } from '../../scripts/serve-geo';
import { createSearch, type Search } from '../../src/core/address/search';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

let search: Search;
let close: () => Promise<void> = async () => undefined;
const keys = [{ id: 'kurye', secret: 'gizli-bir', rps: 100000 }];

beforeAll(async () => {
  const made = await memoryStore({ '34': await builtPack() });
  close = made.close;
  search = createSearch({ store: made.store, borders: turkeyBorders() });
});
afterAll(async () => close());

const make = (flags: Flags) => createApi({ search, keys, info: { sdk: '0.8.0', data: 'd', format: '2' }, regions: async () => 1, flags: () => flags });
const ask = (path: string, extra: Partial<ApiRequest> = {}): ApiRequest => ({ method: 'GET', path, query: {}, body: undefined, headers: { 'x-api-key': 'gizli-bir' }, remote: '9.9.9.9', ...extra });

describe('bayrak', () => {
  it('yüzde kullanıcıya sabit bağlanır ve yaklaşık yüzde kadarını açar', () => {
    const rule = { percent: 25 };
    const on = Array.from({ length: 4000 }, (_, i) => flagOn(rule, 'address_v2', `kurye-${i}`)).filter(Boolean).length;
    expect(on).toBeGreaterThan(850);
    expect(on).toBeLessThan(1150);
    expect(flagOn(rule, 'address_v2', 'kurye-7')).toBe(flagOn(rule, 'address_v2', 'kurye-7'));
    expect(bucketOf('address_v2', 'kurye-7')).toBe(bucketOf('address_v2', 'kurye-7'));
  });

  it('izin ve ret listesi yüzdeden önce gelir, kullanıcı yoksa yalnız %100 açar', () => {
    expect(flagOn({ percent: 0, allow: ['a'] }, 'f', 'a')).toBe(true);
    expect(flagOn({ percent: 100, deny: ['b'] }, 'f', 'b')).toBe(false);
    expect(flagOn({ percent: 50 }, 'f', undefined)).toBe(false);
    expect(flagOn({ percent: 100 }, 'f', undefined)).toBe(true);
    expect(flagOn(undefined, 'f', 'a')).toBe(false);
  });

  it('uç, tanımsız bayrak için boş, tanımlı için doğru ya da yanlış döner', async () => {
    const api = make({ address_v2: { percent: 100 }, kapali: { percent: 0 } });
    const body = (await api.handle(ask('/v1/flags', { query: { user: 'x' } }))).body as { flags: Record<string, boolean> };
    expect(body.flags).toEqual({ address_v2: true, kapali: false });
    expect(((await make({}).handle(ask('/v1/flags'))).body as { flags: object }).flags).toEqual({});
  });

  it('GEO_FLAGS biçimini ayrıştırır, kötü biçimi reddeder', () => {
    expect(parseFlags('address_v2=25,b=100', 'address_v2:u1|u2', 'b:u3')).toEqual({ address_v2: { percent: 25, allow: ['u1', 'u2'] }, b: { percent: 100, deny: ['u3'] } });
    expect(parseFlags(undefined, undefined, undefined)).toEqual({});
    expect(() => parseFlags('a=120', undefined, undefined)).toThrow();
    expect(() => parseFlags('a', undefined, undefined)).toThrow();
  });
});

describe('olaylar', () => {
  it('yalnız ad ve sayı kabul eder, ölçü ucunda sayaç olarak görünür', async () => {
    const api = make({});
    const post = (events: unknown) => api.handle(ask('/v1/events', { method: 'POST', body: { events } }));
    expect((await post([{ name: 'cozum.basari', count: 3 }, { name: 'cozum.basari', count: 2 }])).status).toBe(200);
    expect((await post([{ name: 'Adres Metni', count: 1 }])).status).toBe(400);
    expect((await post([{ name: 'a', count: 0 }])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    const text = (await api.handle(ask('/metrics'))).body as string;
    expect(text).toContain('geo_client_events_total{name="cozum.basari"} 5');
  });
});
