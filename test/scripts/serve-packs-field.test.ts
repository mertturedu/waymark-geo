import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptField, FIELD_LIMIT, startServer } from '../../scripts/serve-packs';

const good = (overrides: Record<string, unknown> = {}) => ({ id: 'a1', at: 1_762_600_000_000, text: 'Fethiye Mah. Gül Sk. No:12 Nilüfer/Bursa', point: [28.95, 40.22], source: 'gps', accuracyM: 6, floor: '3', door: '7', ...overrides });

const post = (base: string, body: string): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const url = new URL(base);
    const req = http.request({ host: url.hostname, port: url.port, path: '/saha', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });

describe('acceptField', () => {
  it('accepts a list of field records', () => {
    const result = acceptField(JSON.stringify([good(), good({ id: 'a2', source: 'map', accuracyM: null, floor: undefined, door: undefined })]));
    expect(result.ok && result.records.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it.each([
    ['not json', '{'],
    ['an empty list', '[]'],
    ['an object instead of a list', JSON.stringify(good())],
    ['a point outside Turkey', JSON.stringify([good({ point: [2.35, 48.85] })])],
    ['a point with one number', JSON.stringify([good({ point: [28.9] })])],
    ['a too short text', JSON.stringify([good({ text: 'ab' })])],
    ['a too long text', JSON.stringify([good({ text: 'x'.repeat(301) })])],
    ['an unknown source', JSON.stringify([good({ source: 'guess' })])],
    ['a text accuracy', JSON.stringify([good({ accuracyM: '6' })])],
    ['a long floor', JSON.stringify([good({ floor: 'x'.repeat(13) })])],
    ['a missing time', JSON.stringify([good({ at: undefined })])],
    ['a numeric id', JSON.stringify([good({ id: 5 })])],
  ])('rejects %s', (_name, body) => {
    expect(acceptField(body).ok).toBe(false);
  });

  it('rejects more records than the limit', () => {
    expect(acceptField(JSON.stringify(Array.from({ length: FIELD_LIMIT + 1 }, (_, i) => good({ id: `r${i}` })))).ok).toBe(false);
  });
});

describe('POST /saha', () => {
  let fieldDir: string;
  let server: { url: string; close(): Promise<void> };
  let bare: { url: string; close(): Promise<void> };

  beforeAll(async () => {
    const base = mkdtempSync(join(tmpdir(), 'geo-field-'));
    const root = join(base, 'root');
    mkdirSync(root);
    fieldDir = join(base, 'saha');
    server = await startServer({ root, port: 0, host: '127.0.0.1', fieldDir, now: () => Date.UTC(2026, 10, 8, 12, 0, 0) });
    bare = await startServer({ root, port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await server.close();
    await bare.close();
  });

  it('saves the records and answers with their count', async () => {
    const response = await post(server.url, JSON.stringify([good(), good({ id: 'b' })]));
    expect(response).toEqual({ status: 200, body: '2' });
    const files = readdirSync(fieldDir);
    expect(files).toEqual(['20261108T120000-2.json']);
    expect(JSON.parse(readFileSync(join(fieldDir, files[0]!), 'utf8')).map((r: { id: string }) => r.id)).toEqual(['a1', 'b']);
  });

  it('refuses invalid records and saves nothing new', async () => {
    const before = readdirSync(fieldDir).length;
    const response = await post(server.url, JSON.stringify([good({ point: [0, 0] })]));
    expect(response.status).toBe(400);
    expect(readdirSync(fieldDir).length).toBe(before);
  });

  it('is not served when no field folder is set', async () => {
    expect((await post(bare.url, JSON.stringify([good()]))).status).toBe(404);
  });
});
