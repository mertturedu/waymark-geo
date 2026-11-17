import { createApi } from '../../server/api';
import { createSearch } from '../../src/core/address/search';
import { createGeoClient, DEFAULT_TIMEOUT_MS, serverError } from '../../src/core/client';
import { createGeo, type GeoEnv } from '../../src/core/create-geo';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';
import { nodeOpener } from '../helpers/node-opener';
import { blob, makeWorld } from '../helpers/pack-world';
import { bytesOf } from '../helpers/real-world';

type Handler = (url: string, init: RequestInit) => Promise<Response>;

async function inProcess(): Promise<{ fetch: Handler; calls: string[]; close: () => Promise<void> }> {
  const made = await memoryStore({ '34': await builtPack() });
  const api = createApi({ search: createSearch({ store: made.store, borders: turkeyBorders() }), keys: [{ id: 'k', secret: 'gizli', rps: 1000 }], info: { sdk: 't', data: 'd', format: '2' }, regions: async () => 1 });
  const calls: string[] = [];
  const handler: Handler = async (url, init) => {
    calls.push(`${init.method} ${new URL(url).pathname}`);
    const u = new URL(url);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const out = await api.handle({ method: init.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, headers, remote: '1.1.1.1' });
    return new Response(JSON.stringify(out.body), { status: out.status });
  };
  return { fetch: handler as unknown as typeof fetch as never, calls, close: made.close };
}

describe('createGeoClient', () => {
  it('gives the same answers as the search behind the server', async () => {
    const world = await inProcess();
    const client = createGeoClient({ baseUrl: 'http://x/', key: 'gizli', fetch: world.fetch as unknown as typeof fetch, language: 'en' });
    expect((await client.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul', district: 'Kadıköy' }, near: [28.6, 40.7], limit: 2 })).status).toMatch(/resolved|ambiguous/);
    expect((await client.validate('Bahariye Caddesi 14 Kadıköy İstanbul')).status).toBeDefined();
    expect((await client.autocomplete('bahariye', { deep: false })).length).toBeGreaterThan(0);
    expect((await client.autocomplete('bahariye')).length).toBeGreaterThan(0);
    expect(await client.reverse([28.6, 40.7], { heading: 90, accuracyM: 10 })).not.toBeUndefined();
    expect((await client.nearby({ point: [28.645, 40.745], group: 'pharmacy', radiusM: 2000, limit: 2 }))[0]?.distanceM).toBeLessThan(10);
    const asked = await client.resolve('Bahariye Caddesi Kadıköy İstanbul', { geometry: true });
    const top = asked.status === 'resolved' ? asked.best : asked.status === 'ambiguous' ? asked.candidates[0] : undefined;
    expect(top?.geometry?.kind).toBe('street');
    expect((await client.geometry(top as never))?.geometry?.kind).toBe('street');
    expect(await client.health()).toMatchObject({ ok: true });
    expect(await client.version()).toMatchObject({ format: '2' });
    expect(world.calls).toContain('POST /v1/geocode');
    expect(world.calls).toContain('GET /v1/reverse');
    await world.close();
  });

  it('turns an error answer into an error with status and code, and a broken answer into one too', async () => {
    const make = (response: () => Response) => createGeoClient({ baseUrl: 'http://x', key: 'k', fetch: (async () => response()) as unknown as typeof fetch });
    await expect(make(() => new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'yavaş' } }), { status: 429 })).resolve('x')).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: 'yavaş' });
    await expect(make(() => new Response('<html>', { status: 502 })).resolve('x')).rejects.toMatchObject({ status: 502, code: 'error', message: 'HTTP 502' });
    expect(serverError(500, 'internal', 'x')).toMatchObject({ status: 500, code: 'internal' });
  });

  it('gives up when the server does not answer in time and cancels the request', async () => {
    let aborted = false;
    const slow = (async (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('iptal'));
        });
      })) as unknown as typeof fetch;
    const client = createGeoClient({ baseUrl: 'http://x', key: 'k', fetch: slow, timeoutMs: 20 });
    await expect(client.reverse([29, 41])).rejects.toThrow('iptal');
    expect(aborted).toBe(true);
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(1000);
  });
});

const envOf = (world: Awaited<ReturnType<typeof makeWorld>>): GeoEnv => ({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity, opener: nodeOpener(world), learnStore: learnStore(), borders: turkeyBorders() });

describe('geo with an online fallback', () => {
  async function geoWith(online: boolean, fetcher: typeof fetch) {
    const world = await makeWorld({ regions: [{ id: '34', parts: { address: bytesOf(await builtPack()), tiles: blob(5_000, 3) } }] });
    const original = globalThis.fetch;
    globalThis.fetch = fetcher;
    const geo = await createGeo({ ...world.config, ...(online ? { online: { baseUrl: 'http://x', key: 'gizli' } } : {}) }, envOf(world));
    return { geo, restore: () => { globalThis.fetch = original; } };
  }

  it('asks the server only when the region is not installed, and falls back to the offline answer when it fails', async () => {
    const server = await inProcess();
    const { geo, restore } = await geoWith(true, server.fetch as unknown as typeof fetch);
    try {
      await geo.regions.checkUpdates();
      const missing = await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } });
      expect(missing.status).toMatch(/resolved|ambiguous/);
      expect(server.calls).toContain('POST /v1/geocode');
      expect((await geo.search.resolve({ street: 'Bahariye Caddesi', houseNumber: '14', district: 'Kadıköy', province: 'İstanbul' })).status).not.toBe('region_missing');
      expect((await geo.search.validate('Bahariye Caddesi 14 Kadıköy İstanbul')).status).not.toBe('not_found');
      expect((await geo.search.autocomplete('bahariye')).length).toBeGreaterThan(0);
      expect(await geo.search.reverse([28.6, 40.7])).not.toBeNull();
      const before = server.calls.length;
      await geo.regions.download('34', { parts: ['address'] });
      await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } });
      expect(server.calls.length).toBe(before);
    } finally {
      restore();
      await geo.dispose();
      await server.close();
    }
  });

  it('keeps the offline answer when the server cannot be reached', async () => {
    const { geo, restore } = await geoWith(true, (async () => { throw new Error('ağ yok'); }) as unknown as typeof fetch);
    try {
      await geo.regions.checkUpdates();
      expect((await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } })).status).toBe('region_missing');
      expect(await geo.search.reverse([28.6, 40.7])).toBeNull();
    } finally {
      restore();
      await geo.dispose();
    }
  });

  it('never calls out without the online setting', async () => {
    let called = false;
    const { geo, restore } = await geoWith(false, (async () => { called = true; return new Response('{}'); }) as unknown as typeof fetch);
    try {
      await geo.regions.checkUpdates();
      expect((await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } })).status).toBe('region_missing');
      expect(called).toBe(false);
    } finally {
      restore();
      await geo.dispose();
    }
  });
});
