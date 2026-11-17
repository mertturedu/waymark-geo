import http from 'node:http';
import { createSearch, type Search } from '../src/core/address/search';
import { SDK_VERSION } from '../src/core/create-geo';
import { createLearnedLayer } from '../src/core/learned/layer';
import { embeddedBorders } from '../src/core/region/embedded';
import { createApi, type ApiResponse, type Flags } from './api';
import type { ApiKey } from './guard';
import { createServerStore, type ServerStore } from './store';

export type ServerOptions = { packsDir: string; keys: readonly ApiKey[]; flags?: () => Flags; maxOpen?: number; idleMs?: number; log?: (line: string) => void };

export type GeoServer = { server: http.Server; store: ServerStore; search: Search; listen(port: number, host?: string): Promise<number>; close(): Promise<void> };

export const BODY_LIMIT = 256 * 1024;
export const DEFAULT_MAX_OPEN = 12;
export const DEFAULT_IDLE_MS = 300_000;

const clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

const DISCARD_LIMIT = BODY_LIMIT * 16;

function readBody(request: http.IncomingMessage): Promise<{ ok: true; text: string } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > DISCARD_LIMIT) request.destroy();
      else if (size <= BODY_LIMIT) chunks.push(chunk);
    });
    request.on('end', () => resolve(size > BODY_LIMIT ? { ok: false } : { ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    request.on('error', () => resolve({ ok: false }));
    request.on('close', () => resolve({ ok: false }));
  });
}

const send = (response: http.ServerResponse, result: ApiResponse): void => {
  const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
  response.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...(result.status === 413 ? { connection: 'close' } : {}), ...(result.headers ?? {}) });
  response.end(body);
};

export function createGeoServer(options: ServerOptions): GeoServer {
  const store = createServerStore(options.packsDir);
  const search = createSearch({ store, borders: embeddedBorders(), layers: [createLearnedLayer(store)], clock, maxOpen: options.maxOpen ?? DEFAULT_MAX_OPEN, idleMs: options.idleMs ?? DEFAULT_IDLE_MS });
  store.onChange((regions) => {
    for (const plate of regions) search.invalidate(plate);
  });
  const api = createApi({
    search,
    openHandles: () => store.handles(),
    ...(options.flags ? { flags: options.flags } : {}),
    keys: options.keys,
    info: () => ({ sdk: SDK_VERSION, data: store.manifest.osm.time, format: String(store.manifest.format), learned: store.learnedAt() }),
    regions: async () => (await store.installed()).length,
    ...(options.log ? { log: options.log } : {}),
  });

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      let body: unknown;
      if (request.method === 'POST') {
        const got = await readBody(request);
        if (!got.ok) {
          send(response, { status: 413, body: { error: { code: 'too_large', message: 'istek gövdesi çok büyük' } } });
          return;
        }
        try {
          body = got.text === '' ? undefined : JSON.parse(got.text);
        } catch {
          send(response, { status: 400, body: { error: { code: 'bad_request', message: 'gövde JSON değil' } } });
          return;
        }
      }
      send(response, await api.handle({ method: request.method ?? 'GET', path: url.pathname, query, body, headers: request.headers, remote: request.socket.remoteAddress ?? '' }));
    })().catch(() => {
      if (!response.headersSent) send(response, { status: 500, body: { error: { code: 'internal', message: 'sunucu hatası' } } });
      else response.destroy();
    });
  });

  return {
    server,
    store,
    search,
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve((server.address() as { port: number }).port));
      }),
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await store.closeAll();
    },
  };
}
