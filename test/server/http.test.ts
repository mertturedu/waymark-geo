import { createGeoServer, BODY_LIMIT, type GeoServer } from '../../server';
import { createGeoClient } from '../../src/core/client';
import { packsDir } from './helpers';

let server: GeoServer;
let base = '';
const lines: string[] = [];

beforeAll(async () => {
  server = createGeoServer({ packsDir: await packsDir(), keys: [{ id: 'kargo', secret: 'gizli-bir' }], log: (line) => lines.push(line) });
  base = `http://127.0.0.1:${await server.listen(0)}`;
});
afterAll(async () => server.close());

const post = (path: string, body: string, key = 'gizli-bir') => fetch(`${base}${path}`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body });

describe('the http server', () => {
  it('answers health and version, geocodes through a client and reverses a point', async () => {
    const client = createGeoClient({ baseUrl: base, key: 'gizli-bir' });
    expect(await client.health()).toMatchObject({ ok: true, regions: 1 });
    expect((await client.version()).format).toBe('1');
    const online = await client.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' }, limit: 3 });
    const offline = await server.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' }, limit: 3 });
    expect(online).toEqual(JSON.parse(JSON.stringify(offline)));
    expect(await client.reverse([28.6, 40.7])).toEqual(JSON.parse(JSON.stringify(await server.search.reverse([28.6, 40.7]))));
    expect((await client.nearby({ point: [28.645, 40.745], group: 'pharmacy', radiusM: 2000 }))[0]?.place.components.poiName).toBe('Merkez Eczanesi');
    expect((await client.autocomplete('bahariye', { deep: false })).length).toBeGreaterThan(0);
    expect((await client.validate('Bahariye Caddesi 14 Kadıköy İstanbul')).status).toBeDefined();
  });

  it('refuses without a key, a body that is too large or not JSON, and sends no cache headers or secrets', async () => {
    expect((await post('/v1/geocode', '{"q":"x"}', 'yanlis')).status).toBe(401);
    expect((await post('/v1/geocode', 'json degil')).status).toBe(400);
    expect((await post('/v1/geocode', JSON.stringify({ q: 'x'.repeat(BODY_LIMIT) }))).status).toBe(413);
    const empty = await post('/v1/geocode', '');
    expect(empty.status).toBe(400);
    const ok = await post('/v1/geocode', JSON.stringify({ q: 'bahariye caddesi 14' }));
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('content-type')).toMatch(/json/);
    expect(lines.join('\n')).not.toMatch(/bahariye|gizli-bir|yanlis/i);
  });

  it('says what went wrong through the client', async () => {
    const client = createGeoClient({ baseUrl: base, key: 'yanlis' });
    await expect(client.resolve('x')).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });
});
