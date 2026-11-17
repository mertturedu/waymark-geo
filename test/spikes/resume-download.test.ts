import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../scripts/serve-packs';
import { seededBytes } from '../../scripts/spikes/blob';
import { DownloadError, download, planResume, storeSha256, type Store } from '../../scripts/spikes/resume-download';

jest.setTimeout(30_000);

const SIZE = 8 * 1024 * 1024;
const data = seededBytes(21, SIZE);
const sha = createHash('sha256').update(data).digest('hex');

class MemStore implements Store {
  bytes: Uint8Array = new Uint8Array(0);
  constructor(initial?: Uint8Array) {
    if (initial) this.bytes = initial;
  }
  async size() {
    return this.bytes.length;
  }
  async append(chunk: Uint8Array) {
    const next = new Uint8Array(this.bytes.length + chunk.length);
    next.set(this.bytes);
    next.set(chunk, this.bytes.length);
    this.bytes = next;
  }
  async truncate() {
    this.bytes = new Uint8Array(0);
  }
  async read(offset: number, length: number) {
    return this.bytes.subarray(offset, offset + length);
  }
}

type Seen = { method: string; range: string | null };

const wrap = (inner: typeof fetch, seen: Seen[], tweak?: (call: number, response: Response, method: string) => Response | Promise<Response>): typeof fetch => {
  let call = 0;
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = new Headers(init?.headers);
    const method = init?.method ?? 'GET';
    seen.push({ method, range: headers.get('range') });
    const response = await inner(input, init);
    call++;
    return tweak ? tweak(call, response, method) : response;
  }) as typeof fetch;
};

const cutBody = (response: Response, afterBytes: number): Response => {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= afterBytes) {
        controller.error(new Error('connection reset'));
        void reader.cancel();
        return;
      }
      const { done, value } = await reader.read();
      if (done) return controller.close();
      const piece = value.subarray(0, Math.min(value.length, afterBytes - sent));
      sent += piece.length;
      controller.enqueue(piece);
    },
  });
  return new Response(body, { status: response.status, headers: response.headers });
};

const flipFirstByte = (response: Response): Response => {
  const body = response.body as ReadableStream<Uint8Array>;
  let first = true;
  const out = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (first) {
          chunk = chunk.slice();
          chunk[0] = (chunk[0] as number) ^ 0xff;
          first = false;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(out, { status: response.status, headers: response.headers });
};

let server: { url: string; close(): Promise<void> };
beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'geo-resume-'));
  writeFileSync(join(root, 'f.bin'), data);
  writeFileSync(join(root, 'cut.bin'), data);
  server = await startServer({ root, port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  await server.close();
});

const run = (store: Store, overrides: Partial<Parameters<typeof download>[0]> = {}, file = 'f.bin') =>
  download({ url: `${server.url}/${file}`, store, sha256: sha, fetchImpl: fetch, maxRetries: 5, ...overrides });

describe('planResume', () => {
  it.each([
    [0, 100, { start: 0, total: 100, done: false }],
    [40, 100, { start: 40, total: 100, done: false }],
    [100, 100, { start: 100, total: 100, done: true }],
    [120, 100, { start: 0, total: 100, done: false }],
  ])('existing %i of %i', (existing, total, expected) => {
    expect(planResume(existing, total)).toEqual(expected);
  });
});

describe('download', () => {
  it('downloads a whole file and verifies its checksum', async () => {
    const store = new MemStore();
    const progress: number[] = [];
    const result = await run(store, { onProgress: (done) => progress.push(done) });
    expect(result).toEqual({ bytes: SIZE, retries: 0 });
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
    expect(progress[progress.length - 1]).toBe(SIZE);
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
  });

  it('resumes with a range request after the server cut the first response', async () => {
    const store = new MemStore();
    const seen: Seen[] = [];
    const result = await run(store, { fetchImpl: wrap(fetch, seen) }, 'cut.bin?cut=0.3');
    expect(result.retries).toBe(1);
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
    const gets = seen.filter((s) => s.method === 'GET');
    expect(gets[0]?.range).toBe('bytes=0-');
    expect(gets[1]?.range).toMatch(/^bytes=[1-9]\d*-$/);
  });

  it('survives three cuts in a row', async () => {
    const store = new MemStore();
    const seen: Seen[] = [];
    const flaky = wrap(fetch, seen, (call, response, method) => (method === 'GET' && call <= 4 ? cutBody(response, 1024 * 1024) : response));
    const result = await run(store, { fetchImpl: flaky });
    expect(result.retries).toBe(3);
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('keeps the partial file when retries run out', async () => {
    const store = new MemStore();
    const flaky = wrap(fetch, [], (_call, response, method) => (method === 'GET' ? cutBody(response, 512 * 1024) : response));
    await expect(run(store, { fetchImpl: flaky, maxRetries: 2 })).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(store.bytes.length).toBeGreaterThan(0);
    expect(store.bytes.length).toBeLessThan(SIZE);
  });

  it('names the last network error when retries run out', async () => {
    const store = new MemStore();
    const flaky = wrap(fetch, [], (_call, response, method) => (method === 'GET' ? cutBody(response, 512 * 1024) : response));
    await expect(run(store, { fetchImpl: flaky, maxRetries: 1 })).rejects.toThrow(/connection reset/);
  });

  it('names the store error when writing to disk keeps failing', async () => {
    const store = new MemStore();
    store.append = async () => {
      throw new Error('disk full');
    };
    await expect(run(store, { maxRetries: 2 })).rejects.toThrow(/disk full/);
  });

  it('continues from an existing correct partial file', async () => {
    const store = new MemStore(data.slice(0, 1024 * 1024));
    const seen: Seen[] = [];
    await run(store, { fetchImpl: wrap(fetch, seen) });
    expect(seen.filter((s) => s.method === 'GET')[0]?.range).toBe(`bytes=${1024 * 1024}-`);
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('starts over when the existing file is larger than the remote file', async () => {
    const store = new MemStore(new Uint8Array(SIZE + 10));
    const seen: Seen[] = [];
    await run(store, { fetchImpl: wrap(fetch, seen) });
    expect(seen.filter((s) => s.method === 'GET')[0]?.range).toBe('bytes=0-');
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('only verifies when the file is already complete', async () => {
    const store = new MemStore(data.slice());
    const seen: Seen[] = [];
    const result = await run(store, { fetchImpl: wrap(fetch, seen) });
    expect(result.bytes).toBe(SIZE);
    expect(seen.filter((s) => s.method === 'GET')).toHaveLength(0);
  });

  it('restarts from zero when the server ignores the range header', async () => {
    const store = new MemStore(data.slice(0, 2 * 1024 * 1024));
    const ignoring = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers);
      headers.delete('range');
      return fetch(input, { ...init, headers });
    }) as typeof fetch;
    await run(store, { fetchImpl: ignoring });
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('retries once from scratch when the first complete download is corrupt', async () => {
    const store = new MemStore();
    let gets = 0;
    const corrupting = wrap(fetch, [], (_call, response, method) => {
      if (method !== 'GET') return response;
      gets++;
      return gets === 1 ? flipFirstByte(response) : response;
    });
    await run(store, { fetchImpl: corrupting });
    expect(gets).toBe(2);
    expect(Buffer.from(store.bytes).equals(Buffer.from(data))).toBe(true);
  });

  it('fails with CHECKSUM_MISMATCH and clears the file when the data is always wrong', async () => {
    const store = new MemStore();
    const corrupting = wrap(fetch, [], (_call, response, method) => (method === 'GET' ? flipFirstByte(response) : response));
    await expect(run(store, { fetchImpl: corrupting })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
    expect(store.bytes.length).toBe(0);
  });

  it('fails with HTTP_ERROR and clears the file when the resume request is refused', async () => {
    const store = new MemStore();
    const refusing = wrap(fetch, [], (call, response, method) => {
      if (method !== 'GET') return response;
      return call === 2 ? cutBody(response, 1024 * 1024) : new Response('gone', { status: 404 });
    });
    await expect(run(store, { fetchImpl: refusing })).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(store.bytes.length).toBe(0);
  });

  it('refuses to start without enough free space', async () => {
    const store = new MemStore();
    const seen: Seen[] = [];
    await expect(run(store, { fetchImpl: wrap(fetch, seen), freeBytes: async () => 1000 })).rejects.toMatchObject({ code: 'INSUFFICIENT_SPACE' });
    expect(store.bytes.length).toBe(0);
    expect(seen.filter((s) => s.method === 'GET')).toHaveLength(0);
  });

  it('counts the already downloaded part when checking free space', async () => {
    const store = new MemStore(data.slice(0, SIZE - 100));
    await expect(run(store, { freeBytes: async () => 1000 })).resolves.toMatchObject({ bytes: SIZE });
  });

  it('reports an unreachable server as HEAD_FAILED', async () => {
    const store = new MemStore();
    await expect(download({ url: 'http://127.0.0.1:1/x.bin', store, sha256: sha, fetchImpl: fetch, maxRetries: 1 })).rejects.toMatchObject({ code: 'HEAD_FAILED' });
    await expect(run(store, {}, 'missing.bin')).rejects.toBeInstanceOf(DownloadError);
  });
});

describe('yielding', () => {
  it('hands control back while hashing a stored file', async () => {
    const store = new MemStore(data);
    let waits = 0;
    const digest = await storeSha256(store, SIZE, async () => void waits++);
    expect(digest).toBe(sha);
    expect(waits).toBe(SIZE / (1024 * 1024));
  });

  it('hands control back while downloading and verifying', async () => {
    const store = new MemStore();
    let waits = 0;
    const result = await run(store, { yieldNow: async () => void waits++ });
    expect(result.bytes).toBe(SIZE);
    expect(waits).toBeGreaterThan(SIZE / (1024 * 1024));
  });

  it('verifies with the supplied hash function when one is given', async () => {
    const store = new MemStore();
    const asked: number[] = [];
    const result = await run(store, {
      hashStore: async (_store, total) => {
        asked.push(total);
        return sha;
      },
    });
    expect(result.bytes).toBe(SIZE);
    expect(asked).toEqual([SIZE]);
  });

  it('treats a wrong answer from the supplied hash function as a mismatch', async () => {
    const store = new MemStore();
    await expect(run(store, { hashStore: async () => 'ab'.repeat(32) })).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' });
  });

  it('cancels the response it abandons when writing to the store fails', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    const failing: Store = {
      size: async () => 0,
      append: async () => {
        throw new Error('disk full');
      },
      truncate: async () => undefined,
      read: async () => new Uint8Array(0),
    };
    const fetchImpl = (async (_url: unknown, init?: RequestInit) =>
      init?.method === 'HEAD' ? new Response(null, { headers: { 'content-length': '4096' } }) : new Response(body, { status: 200 })) as typeof fetch;
    await expect(run(failing, { fetchImpl, maxRetries: 0 })).rejects.toMatchObject({ code: 'DOWNLOAD_FAILED' });
    expect(cancelled).toBe(true);
  });
});
