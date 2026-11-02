import { formatReport } from '../../src/core/report/format';
import { parseReport } from '../../src/core/report/parse';
import { buildReport, runTest } from '../../example/src/device-test/runner';
import type { DeviceTest, TestContext } from '../../example/src/device-test/types';

const ctx: TestContext = { packServerUrl: 'http://192.168.1.110:8090', packsDir: '/docs/packs', reportDir: '/docs/reports', log: () => undefined };

const auto = (id: string, run: DeviceTest['run']): DeviceTest => ({ id, title: `Test ${id}`, kind: 'auto', run });

describe('runTest', () => {
  it('passes the result through with the test identity', async () => {
    const entry = await runTest(auto('a', async () => ({ outcome: 'pass', value: '12', unit: 'ms', threshold: '≤ 150', note: 'tamam' })), ctx, 1000);
    expect(entry).toEqual({ id: 'a', title: 'Test a', kind: 'auto', outcome: 'pass', value: '12', unit: 'ms', threshold: '≤ 150', note: 'tamam' });
  });

  it('turns a thrown error into a failed entry carrying the message', async () => {
    const entry = await runTest(auto('b', async () => { throw new Error('dosya yok'); }), ctx, 1000);
    expect(entry).toMatchObject({ id: 'b', outcome: 'fail' });
    expect(entry.note).toContain('dosya yok');
  });

  it('turns a non error rejection into a failed entry', async () => {
    const entry = await runTest(auto('c', () => Promise.reject('düz yazı')), ctx, 1000);
    expect(entry).toMatchObject({ outcome: 'fail', note: expect.stringContaining('düz yazı') });
  });

  it('fails a test that outlives its timeout', async () => {
    const started = Date.now();
    const entry = await runTest(auto('d', () => new Promise(() => undefined)), ctx, 50);
    expect(entry).toMatchObject({ id: 'd', outcome: 'fail', note: expect.stringContaining('zaman aşımı') });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not report a timeout for a test that finished in time', async () => {
    const entry = await runTest(auto('e', async () => ({ outcome: 'info', value: '1' })), ctx, 50);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(entry.outcome).toBe('info');
  });

  it('gives the test the context it was started with', async () => {
    let seen: TestContext | null = null;
    await runTest(auto('f', async (c) => { seen = c; return { outcome: 'pass' }; }), ctx, 1000);
    expect(seen).toBe(ctx);
  });
});

describe('buildReport', () => {
  const info = { device: { model: 'iPhone12,1', os: 'iOS 26.0', memoryMB: 3796 }, sdk: { version: '0.0.0', dataVersion: '20261022', build: 'release' as const }, now: new Date(Date.UTC(2026, 9, 22, 13, 5, 9)) };

  it('builds a report that the parser reads back', () => {
    const entries = [{ id: 'x', title: 'İstanbul | harita', kind: 'manual' as const, outcome: 'pass' as const, note: 'ı\nİ 😀' }];
    const report = buildReport(entries, info);
    expect(parseReport(formatReport(report))).toEqual({ ok: true, report });
    expect(report.createdAt).toBe('2026-10-22T13:05:09.000Z');
  });

  it('derives a file safe report id from the model and the time', () => {
    const report = buildReport([], { ...info, device: { model: 'Pixel 8 Pro/Ü', os: 'Android 16' } });
    expect(report.reportId).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(report.reportId).toContain('20261022-130509');
  });

  it('keeps the order of the entries', () => {
    const entries = ['b', 'a', 'c'].map((id) => ({ id, title: id, kind: 'auto' as const, outcome: 'info' as const }));
    expect(buildReport(entries, info).entries.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });
});
