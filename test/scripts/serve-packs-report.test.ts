import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { formatReport } from '../../src/core';
import { callerKind, isLocalAddress, jobTargetOf, REPORT_LIMIT, startServer } from '../../scripts/serve-packs';

let reportDir: string;
let server: { url: string; close(): Promise<void> };
let bare: { url: string; close(): Promise<void> };
const clock = { t: 1_000_000 };

const post = (base: string, body: string | Buffer, path = '/report'): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.request({ host: url.hostname, port: url.port, path, method: 'POST', headers: { 'Content-Type': 'text/plain' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', (error) => (String(error).includes('EPIPE') || String(error).includes('ECONNRESET') ? resolve({ status: 413, body: '' }) : reject(error)));
    req.end(body);
  });

const report = (id: string) =>
  formatReport({
    reportId: id,
    createdAt: '2026-11-02T10:00:00.000Z',
    device: { model: 'iPhone12,1', os: 'iOS 26.1', memoryMB: 3800 },
    sdk: { version: '0.4.0', dataVersion: '20261028.20261030', build: 'release' },
    entries: [
      { id: 'sdk.map-open', title: 'Harita açılır', kind: 'auto', outcome: 'pass', value: '496', unit: 'ms' },
      { id: 'sdk.perf-pan', title: 'Kaydırma', kind: 'auto', outcome: 'info', value: '812', unit: 'ms' },
    ],
  });

beforeAll(async () => {
  const base = mkdtempSync(join(tmpdir(), 'geo-report-'));
  const root = join(base, 'root');
  mkdirSync(root);
  reportDir = join(base, 'reports');
  server = await startServer({ root, port: 0, host: '127.0.0.1', reportDir, now: () => clock.t });
  bare = await startServer({ root, port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await server.close();
  await bare.close();
});

describe('report upload', () => {
  it('stores a valid report as json and markdown', async () => {
    const result = await post(server.url, report('iPhone12,1-20261102-100000'));
    expect(result.status).toBe(200);
    expect(result.body).toMatch(/cihaz-iPhone12_1-20261102-100000\.json$/);
    expect(existsSync(result.body)).toBe(true);
    expect(readFileSync(result.body.replace(/\.json$/, '.md'), 'utf8')).toContain('sdk.perf-pan');
  });

  it('rejects a broken report without writing a file', async () => {
    const before = existsSync(reportDir) ? readdirSync(reportDir).length : 0;
    const result = await post(server.url, 'merhaba');
    expect(result.status).toBe(400);
    expect(readdirSync(reportDir).length).toBe(before);
  });

  it('refuses a body over the limit', async () => {
    const result = await post(server.url, Buffer.alloc(REPORT_LIMIT + 1024, 65));
    expect(result.status).toBe(413);
  });

  it('keeps the report id out of the path', async () => {
    const result = await post(server.url, report('../../evil'));
    expect(result.status).toBe(200);
    expect(dirname(result.body)).toBe(reportDir);
    expect(basename(result.body)).not.toContain('/');
  });

  it('is closed when the server has no report folder', async () => {
    expect((await post(bare.url, report('x'))).status).toBe(404);
  });

  it('still refuses other write methods', async () => {
    expect((await post(server.url, 'x', '/file.bin')).status).toBe(405);
  });
});

const get = (base: string, path: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const url = new URL(base);
    http.get({ host: url.hostname, port: url.port, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  });

describe('run jobs', () => {
  it('hands a queued job out once', async () => {
    expect((await get(server.url, '/run')).status).toBe(204);
    expect((await post(server.url, '{"ids":["sdk.map-open"],"n":"5"}', '/run')).status).toBe(200);
    const first = await get(server.url, '/run');
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toEqual({ ids: ['sdk.map-open'], n: '5' });
    expect((await get(server.url, '/run')).status).toBe(204);
  });

  it('drops a job nobody picked up for ten minutes', async () => {
    expect((await post(server.url, '{"ids":["a"],"n":"6"}', '/run')).status).toBe(200);
    clock.t += 10 * 60 * 1000 + 1;
    expect((await get(server.url, '/run')).status).toBe(204);
  });

  it('refuses a broken job and stays closed without a report folder', async () => {
    expect((await post(server.url, '{"ids":[]}', '/run')).status).toBe(400);
    expect((await post(bare.url, '{"ids":["a"],"n":"1"}', '/run')).status).toBe(404);
    expect((await get(bare.url, '/run')).status).toBe(404);
  });
});

describe('job targets', () => {
  it('tells a call from this machine (simulator) from one over the network (phone)', () => {
    expect(callerKind('192.168.1.101', '192.168.1.101')).toBe('sim');
    expect(callerKind('::ffff:192.168.1.101', '192.168.1.101')).toBe('sim');
    expect(callerKind('127.0.0.1', '127.0.0.1')).toBe('sim');
    expect(callerKind('::1', '::1')).toBe('sim');
    expect(callerKind('192.168.1.110', '192.168.1.101')).toBe('phone');
  });

  it('reads the target of a job', () => {
    expect(jobTargetOf('{"ids":["a"],"target":"phone","n":"1"}')).toBe('phone');
    expect(jobTargetOf('{"target":"sim"}')).toBe('sim');
    expect(jobTargetOf('{"target":"tv"}')).toBeNull();
    expect(jobTargetOf('{')).toBeNull();
    expect(jobTargetOf('{"ids":["a"]}')).toBeNull();
  });

  it('keeps a phone job from the simulator and hands a simulator job to it', async () => {
    expect((await post(server.url, '{"ids":["a"],"target":"phone","n":"11"}', '/run')).status).toBe(200);
    expect((await get(server.url, '/run')).status).toBe(204);
    expect((await post(server.url, '{"ids":["a"],"target":"sim","n":"12"}', '/run')).status).toBe(200);
    expect((await get(server.url, '/run')).status).toBe(200);
  });
});

describe('marks', () => {
  it('records the marks the app sends and lists them in order', async () => {
    const before = JSON.parse((await get(server.url, '/marks')).body) as { id: string }[];
    expect((await get(server.url, '/mark/kadikoy-z16')).status).toBe(200);
    expect((await get(server.url, '/mark/besiktas%20z16')).status).toBe(200);
    const after = JSON.parse((await get(server.url, '/marks')).body) as { id: string; at: number }[];
    expect(after.slice(before.length).map((m) => m.id)).toEqual(['kadikoy-z16', 'besiktas z16']);
    expect(after.at(-1)!.at).toBeGreaterThanOrEqual(after.at(-2)!.at);
  });

  it('is closed without a report folder', async () => {
    expect((await get(bare.url, '/mark/x')).status).toBe(404);
    expect((await get(bare.url, '/marks')).status).toBe(404);
  });
});

describe('isLocalAddress', () => {
  it.each([
    ['127.0.0.1', true],
    ['::1', true],
    ['::ffff:192.168.1.110', true],
    ['10.0.0.4', true],
    ['172.16.0.1', true],
    ['172.31.255.1', true],
    ['172.32.0.1', false],
    ['8.8.8.8', false],
    ['', false],
  ])('%s → %s', (address, expected) => {
    expect(isLocalAddress(address)).toBe(expected);
  });
});
