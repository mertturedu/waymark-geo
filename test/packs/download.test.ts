import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import fc from 'fast-check';
import { downloadFile } from '../../src/core/packs/download';
import type { FsPort } from '../../src/core/packs/ports';
import { createFakeEnv, type FakeEnv } from '../helpers/fake-env';

const URL = 'https://packs.example/34/address-0a0b0c0d.sqlite';
const content = (n: number, seed = 3): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed + (i >> 8)) & 255);

type Job = { env: FakeEnv; bytes: Uint8Array; run: (extra?: { onVerify?: () => void; signal?: AbortSignal; fs?: FsPort; maxRetries?: number; onProgress?: (d: number, t: number) => void }) => Promise<{ bytes: number; retries: number }> };

function job(size = 100_000, options: { capacity?: number; sha?: string } = {}): Job {
  const env = createFakeEnv(options.capacity === undefined ? {} : { capacity: options.capacity });
  const bytes = content(size);
  env.server.put(URL, bytes);
  const run: Job['run'] = (extra = {}) =>
    downloadFile({
      fs: extra.fs ?? env.fs,
      net: env.net,
      hash: env.hash,
      clock: env.clock,
      url: URL,
      partPath: '.part/34__address.sqlite',
      finalPath: 'files/34/address.sqlite',
      size,
      sha256: options.sha ?? bytesToHex(sha256(bytes)),
      ...(extra.signal ? { signal: extra.signal } : {}),
      ...(extra.onVerify ? { onVerify: extra.onVerify } : {}),
      ...(extra.maxRetries !== undefined ? { maxRetries: extra.maxRetries } : {}),
      ...(extra.onProgress ? { onProgress: extra.onProgress } : {}),
    });
  return { env, bytes, run };
}

const stored = (env: FakeEnv, path: string): number[] => Array.from(env.fs.files.get(path) ?? []);

describe('downloadFile', () => {
  it('downloads, verifies and moves the file into place', async () => {
    const { env, bytes, run } = job();
    const progress: [number, number][] = [];
    const result = await run({ onProgress: (d, t) => progress.push([d, t]) });
    expect(result).toEqual({ bytes: 100_000, retries: 0 });
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
    expect(env.fs.files.has('.part/34__address.sqlite')).toBe(false);
    expect(progress.at(-1)).toEqual([100_000, 100_000]);
    expect(progress.every(([d, t], i) => t === 100_000 && (i === 0 || d >= (progress[i - 1] as [number, number])[0]))).toBe(true);
  });

  it.each([
    ['at the start', 0],
    ['in the middle', 40_000],
    ['at the very end', 100_000],
  ])('continues after the connection drops %s', async (_name, at) => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'cut', afterBytes: at }, times: 1 });
    const result = await run();
    expect(result.retries).toBe(at === 100_000 ? 0 : 1);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
    expect(env.clock.now() > 1_700_000_000_000).toBe(at < 100_000);
    const resumed = env.server.log.filter((r) => r.rangeStart !== null).map((r) => r.rangeStart);
    if (at > 0 && at < 100_000) expect(resumed.length).toBeGreaterThan(0);
    if (at === 100_000) expect(env.server.log.length).toBe(1);
  });

  it('starts over when the server ignores the range', async () => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'cut', afterBytes: 40_000 }, times: 1 });
    env.server.inject({ effect: { kind: 'no-range' }, times: 1 });
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('starts over on a 416 answer', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', bytes.slice(0, 5000));
    env.server.inject({ effect: { kind: 'status', status: 416 }, times: 1 });
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('keeps the partial file through server errors and picks up where it was', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', bytes.slice(0, 30_000));
    env.server.inject({ effect: { kind: 'status', status: 503 }, times: 2 });
    const result = await run();
    expect(result.retries).toBe(2);
    expect(env.server.log.map((r) => r.rangeStart)).toEqual([30_000, 30_000, 30_000]);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it.each([404, 403])('drops the partial file and reports http-404 on %s', async (status) => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', bytes.slice(0, 10));
    env.server.inject({ effect: { kind: 'status', status }, times: 1 });
    await expect(run()).rejects.toMatchObject({ code: 'http-404' });
    expect(env.fs.files.has('.part/34__address.sqlite')).toBe(false);
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('drops the partial file and reports http on other client errors', async () => {
    const { env, run } = job();
    env.server.inject({ effect: { kind: 'status', status: 400 }, times: 1 });
    await expect(run()).rejects.toMatchObject({ code: 'http' });
    expect(env.fs.files.size).toBe(0);
  });

  it('refuses to start when the disk cannot hold the rest, writing nothing', async () => {
    const { env, run } = job(100_000, { capacity: 90_000 });
    await expect(run()).rejects.toMatchObject({ code: 'no-space' });
    expect(env.fs.used()).toBe(0);
    expect(env.server.log).toHaveLength(0);
  });

  it('counts only the missing bytes against the free space', async () => {
    const { env, bytes, run } = job(100_000, { capacity: 105_000 });
    await env.fs.append('.part/34__address.sqlite', bytes.slice(0, 90_000));
    await expect(run()).resolves.toMatchObject({ bytes: 100_000 });
  });

  it('stops with no-space when the disk fills during the download and leaves no final file', async () => {
    const { env, run } = job(100_000, { capacity: 60_000 });
    const lying: FsPort = { ...env.fs, freeBytes: async () => 1e12 };
    await expect(run({ fs: lying })).rejects.toMatchObject({ code: 'no-space' });
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('retries once on a wrong checksum and then reports checksum, keeping nothing', async () => {
    const { env, run } = job(100_000, { sha: 'f'.repeat(64) });
    await expect(run()).rejects.toMatchObject({ code: 'checksum' });
    expect(env.fs.files.size).toBe(0);
    expect(env.server.log).toHaveLength(2);
  });

  it('recovers when only the first copy is corrupt', async () => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'body', bytes: content(100_000, 9) }, times: 1 });
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
    expect(env.server.log).toHaveLength(2);
  });

  it('stops on abort, keeps the partial file and writes no final file', async () => {
    const { env, run } = job();
    const controller = new AbortController();
    const outcome = run({ signal: controller.signal, onProgress: (done) => done >= 20_000 && controller.abort() });
    await expect(outcome).rejects.toMatchObject({ code: 'cancelled' });
    expect((env.fs.files.get('.part/34__address.sqlite') ?? new Uint8Array()).length).toBeGreaterThanOrEqual(20_000);
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('gives up after the allowed number of retries with network', async () => {
    const { env, run } = job();
    env.server.inject({ effect: { kind: 'offline' } });
    await expect(run({ maxRetries: 3 })).rejects.toMatchObject({ code: 'network' });
    expect(env.server.log).toHaveLength(4);
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('does nothing when the final file is already there with the right size', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('files/34/address.sqlite', bytes);
    await expect(run()).resolves.toEqual({ bytes: 100_000, retries: 0 });
    expect(env.server.log).toHaveLength(0);
  });

  it('throws away a partial file that is longer than the file should be', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', content(150_000, 5));
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('replaces a final file of the wrong size', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('files/34/address.sqlite', content(7));
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('ignores bytes the server sends beyond the announced size', async () => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'body', bytes: new Uint8Array([...bytes, 1, 2, 3, 4]) }, times: 1 });
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('announces the verification step once the bytes are complete', async () => {
    const { env, run } = job();
    const events: string[] = [];
    await run({ onVerify: () => events.push(`verify:${env.fs.files.get('.part/34__address.sqlite')?.length}`) });
    expect(events).toEqual(['verify:100000']);
  });

  it('asks for the whole file without a range on a fresh start', async () => {
    const { env, run } = job();
    await run();
    expect(env.server.log.map((r) => r.rangeStart)).toEqual([null]);
  });

  it('hands the abort signal to the network request', async () => {
    const { env, run } = job();
    const controller = new AbortController();
    await run({ signal: controller.signal });
    expect(env.server.log[0]?.signal).toBe(controller.signal);
  });

  it('reports cancelled when the abort lands during the request itself', async () => {
    const { env } = job();
    const controller = new AbortController();
    const net = { ...env.net, get: async () => { controller.abort(); throw new Error('aborted'); } };
    await expect(downloadFile({ fs: env.fs, net, hash: env.hash, clock: env.clock, url: URL, partPath: 'p', finalPath: 'f', size: 10, sha256: 'a'.repeat(64), signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it.each([408, 429, 500, 502])('retries on %s', async (status) => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'status', status }, times: 1 });
    const result = await run();
    expect(result.retries).toBe(1);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it.each([400, 401, 410, 499])('does not retry on %s', async (status) => {
    const { env, run } = job();
    env.server.inject({ effect: { kind: 'status', status }, times: 1 });
    await expect(run()).rejects.toMatchObject({ code: 'http', message: `HTTP ${status}` });
    expect(env.server.log).toHaveLength(1);
  });

  it('names the status in the 404 error', async () => {
    const { env, run } = job();
    env.server.inject({ effect: { kind: 'status', status: 404 }, times: 1 });
    await expect(run()).rejects.toMatchObject({ code: 'http-404', message: 'HTTP 404' });
  });

  it('uses a complete partial file without asking the server, after checking it', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', bytes);
    await run();
    expect(env.server.log).toHaveLength(0);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('downloads again when a complete partial file has the wrong content', async () => {
    const { env, bytes, run } = job();
    await env.fs.append('.part/34__address.sqlite', content(100_000, 8));
    await run();
    expect(env.server.log).toHaveLength(1);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('starts when the free space equals the margin exactly', async () => {
    const { run } = job(100_000, { capacity: 120_000 });
    await expect(run()).resolves.toMatchObject({ bytes: 100_000 });
  });

  it('gives up after repeated range refusals', async () => {
    const { env, run } = job();
    await env.fs.append('.part/34__address.sqlite', content(10));
    env.server.inject({ effect: { kind: 'status', status: 416 } });
    await expect(run()).rejects.toMatchObject({ code: 'http' });
    expect(env.server.log.length).toBeLessThanOrEqual(5);
  });

  it('counts a short but clean end of the stream as a retry', async () => {
    const { env, bytes, run } = job();
    env.server.inject({ effect: { kind: 'body', bytes: bytes.slice(0, 5000) }, times: 1 });
    const result = await run();
    expect(result.retries).toBe(1);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('ends with the exact bytes whatever the cut points are', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 3 }), async (cuts) => {
        const { env, bytes, run } = job();
        for (const at of cuts) env.server.inject({ effect: { kind: 'cut', afterBytes: at }, times: 1 });
        await run({ maxRetries: 6 });
        expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
        expect(env.fs.files.has('.part/34__address.sqlite')).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});
