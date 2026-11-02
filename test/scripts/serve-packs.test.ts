import http from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lanAddress, startServer } from '../../scripts/serve-packs';
import { seededBlob } from '../../scripts/make-test-data';

const SIZE = 1024 * 1024;
let root: string;
let outside: string;
let server: { url: string; close(): Promise<void> };
const logged: string[] = [];
const blob = seededBlob(9, SIZE);

const rawGet = (path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const url = new URL(server.url);
    const req = http.request({ host: url.hostname, port: url.port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'geo-serve-'));
  root = join(base, 'root');
  outside = join(base, 'secret.txt');
  mkdirSync(join(root, 'sub'), { recursive: true });
  writeFileSync(join(root, 'file.bin'), blob);
  writeFileSync(join(root, 'other.bin'), blob);
  writeFileSync(join(root, 'sub', 'ünlü dosya.txt'), 'merhaba');
  writeFileSync(outside, 'TOP-SECRET');
  symlinkSync(outside, join(root, 'link.txt'));
  server = await startServer({ root, port: 0, host: '127.0.0.1', log: (line) => logged.push(line) });
});

afterAll(async () => {
  await server.close();
});

describe('pack server', () => {
  it('serves a whole file with length, ETag and range support advertised', async () => {
    const res = await rawGet('/file.bin');
    expect(res.status).toBe(200);
    expect(res.body.equals(blob)).toBe(true);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.headers.etag).toMatch(/^"/);
  });

  it('serves a byte range', async () => {
    const res = await rawGet('/file.bin', { Range: 'bytes=100-199' });
    expect(res.status).toBe(206);
    expect(res.body.equals(blob.subarray(100, 200))).toBe(true);
    expect(res.headers['content-range']).toBe(`bytes 100-199/${SIZE}`);
  });

  it('serves an open ended range and a suffix range', async () => {
    const open = await rawGet('/file.bin', { Range: `bytes=${SIZE - 500}-` });
    expect(open.status).toBe(206);
    expect(open.body.equals(blob.subarray(SIZE - 500))).toBe(true);
    const suffix = await rawGet('/file.bin', { Range: 'bytes=-10' });
    expect(suffix.body.equals(blob.subarray(SIZE - 10))).toBe(true);
  });

  it('clamps a range end past the file size', async () => {
    const res = await rawGet('/file.bin', { Range: `bytes=${SIZE - 5}-${SIZE + 100}` });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
  });

  it('answers 416 for a range outside the file or malformed', async () => {
    for (const range of [`bytes=${SIZE}-`, `bytes=${SIZE + 10}-${SIZE + 20}`, 'bytes=9-3', 'bytes=abc', 'items=0-1']) {
      const res = await rawGet('/file.bin', { Range: range });
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${SIZE}`);
    }
  });

  it('answers HEAD with the size and no body', async () => {
    const res = await rawGet('/file.bin', {}, 'HEAD');
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(SIZE));
    expect(res.body).toHaveLength(0);
  });

  it('serves files with non-ASCII names through percent encoding', async () => {
    const res = await rawGet('/sub/%C3%BCnl%C3%BC%20dosya.txt');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('merhaba');
  });

  it('refuses paths that climb out of the root', async () => {
    for (const path of ['/..%2f..%2fetc%2fhosts', '/../secret.txt', '/%2e%2e/secret.txt', '/sub/../../secret.txt', '/%2e%2e%2fsecret.txt']) {
      const res = await rawGet(path);
      expect([403, 404]).toContain(res.status);
      expect(res.body.toString()).not.toContain('TOP-SECRET');
    }
  });

  it('refuses a symlink that points outside the root', async () => {
    const res = await rawGet('/link.txt');
    expect(res.status).toBe(403);
    expect(res.body.toString()).not.toContain('TOP-SECRET');
  });

  it('rejects malformed escapes and null bytes', async () => {
    expect((await rawGet('/%E0%A4%A')).status).toBe(400);
    expect((await rawGet('/file.bin%00.txt')).status).toBe(400);
  });

  it('answers 404 for missing files and directories', async () => {
    expect((await rawGet('/yok.bin')).status).toBe(404);
    expect((await rawGet('/sub')).status).toBe(404);
  });

  it('answers 405 for methods other than GET and HEAD', async () => {
    expect((await rawGet('/file.bin', {}, 'POST')).status).toBe(405);
  });

  it('has a health endpoint', async () => {
    const res = await rawGet('/health');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('ok');
  });

  it('cuts the first request that asks for it and serves later requests whole', async () => {
    const first = await rawGet('/file.bin?cut=0.5').then(
      (r) => r.body.length,
      () => -1,
    );
    expect(first).toBeLessThan(SIZE);
    const second = await rawGet('/file.bin?cut=0.5');
    expect(second.status).toBe(200);
    expect(second.body.equals(blob)).toBe(true);
  });

  it('applies the cut to the partial body of a range request', async () => {
    const first = await rawGet('/other.bin?cut=0.1', { Range: 'bytes=0-999' }).then(
      (r) => r.body.length,
      () => -1,
    );
    expect(first).toBeLessThan(1000);
  });
});

describe('request log', () => {
  it('writes one line per finished request with method, path, status and the caller', async () => {
    logged.length = 0;
    await rawGet('/health');
    await rawGet('/../secret.txt');
    await rawGet('/file.bin', { Range: 'bytes=0-9' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(logged).toHaveLength(3);
    expect(logged[0]).toMatch(/GET \/health 200 127\.0\.0\.1/);
    expect(logged[1]).toMatch(/GET .*secret\.txt 40[34]/);
    expect(logged[2]).toMatch(/GET \/file\.bin 206 .*bytes=0-9/);
  });
});

describe('lanAddress', () => {
  it('returns an IPv4 address or null without throwing', () => {
    const address = lanAddress();
    expect(address === null || /^\d+\.\d+\.\d+\.\d+$/.test(address)).toBe(true);
  });
});
