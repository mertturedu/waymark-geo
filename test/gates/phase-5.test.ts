import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exitCodeFor, runGates, type GateContext } from '../../gates/engine';
import { missingFor, phase5Gates } from '../../gates/phase-5';
import { AUTO_IDS, INFO_IDS, QUESTION_IDS, RESTART_IDS } from '../../example/src/sdk-test/ids';
import { sourceHash } from '../../scripts/check-builds';
import type { DeviceReport } from '../../src/core/report/types';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }, reportDir = '/tmp/none', repoRoot = '/repo') => {
  const calls: Call[] = [];
  const ctx: GateContext = { reportDir, repoRoot, run: async (cmd, args) => (calls.push({ cmd, args }), answer({ cmd, args })) };
  return { ctx, calls };
};

const report = (os: string, build: string, outcomes: Record<string, string>, speed = '120'): DeviceReport => ({
  reportId: `${os}-1`,
  createdAt: '2026-10-25T10:00:00Z',
  device: { model: 'iPhone12,1', os },
  sdk: { version: '0.1.0', dataVersion: null, build: build as 'release' },
  entries: Object.entries(outcomes).map(([id, outcome]) => ({ id, title: id, kind: 'auto' as const, outcome: outcome as 'pass', ...(id === 'sdk.search-speed' ? { value: speed } : {}) })),
});

const allPass = (): Record<string, string> => Object.fromEntries([...AUTO_IDS, ...RESTART_IDS, ...QUESTION_IDS].map((id) => [id, 'pass']).concat(INFO_IDS.map((id) => [id, 'info'])));

describe('phase 5 gates', () => {
  it('lists the gates of the plan in order', () => {
    expect(phase5Gates.map((g) => g.id)).toEqual(['K5.1', 'K5.2', 'K5.3', 'K5.4', 'K5.5', 'K5.6', 'K5.6b', 'K5.7', 'K5.7b', 'K5.8', 'K5.9', 'K5.9b', 'K5.9d', 'K5.9c']);
    expect(phase5Gates.every((g) => g.phase === 5)).toBe(true);
    expect(phase5Gates.find((g) => g.id === 'K5.7b')?.allowOpen).toBe(true);
    expect(phase5Gates.find((g) => g.id === 'K5.7')?.allowOpen).toBeFalsy();
  });

  it('asks jest for the rule gates and the package script for K5.3', async () => {
    const { ctx, calls } = ctxWith((call) => (call.args[0] === 'tsx' ? { code: 0, out: 'x\n{"check":"sdk","pass":true,"measured":"kur:ok tip denetimi:ok"}\n' } : { code: 0, out: 'Tests:       9 passed, 9 total\nAll files | 91.50 |\n' }));
    const results = await runGates(phase5Gates, ctx);
    expect(calls.filter((c) => c.args[0] === 'jest' && !c.args.includes('--coverage')).map((c) => c.args.slice(1))).toEqual([
      ['test/packs'],
      ['test/packs/region.test.ts', 'test/region/near-border.test.ts'],
      ['test/i18n'],
      ['test/geo/network-allowlist.test.ts'],
      ['test/packs/store.test.ts', 'test/geo/create-geo.test.ts'],
    ]);
    expect(calls.find((c) => c.args[0] === 'tsx')?.args).toEqual(['tsx', 'scripts/package-check.ts']);
    expect(results.find((r) => r.id === 'K5.3')).toMatchObject({ status: 'pass', measured: 'kur:ok tip denetimi:ok' });
    expect(results.find((r) => r.id === 'K5.1')).toMatchObject({ status: 'pass', measured: '9 passed, 9 total' });
  });

  it('fails K5.3 with the tail of the output when the package check fails', async () => {
    const { ctx } = ctxWith((call) => (call.args[0] === 'tsx' ? { code: 1, out: 'HATA tip denetimi\nboom' } : { code: 0, out: 'ok' }));
    expect((await runGates(phase5Gates, ctx)).find((r) => r.id === 'K5.3')).toMatchObject({ status: 'fail', measured: 'HATA tip denetimi / boom' });
  });

  it('measures mutation on the new modules only and reads the score', async () => {
    const { ctx, calls } = ctxWith(() => ({ code: 0, out: 'All files |  86.40 |\n' }));
    const results = await runGates(phase5Gates, ctx);
    expect(calls.find((c) => c.args.includes('stryker'))?.args).toEqual(['stryker', 'run', '--mutate', 'src/{core/packs,core/i18n,native/logic,native/map}/*.ts,src/core/region/borders.ts']);
    expect(results.find((r) => r.id === 'K5.8')).toMatchObject({ status: 'pass', measured: 'mutasyon 86.40; kapsam eşikleri geçti' });
  });

  describe('K5.4 build record', () => {
    const repo = (): string => {
      const root = mkdtempSync(join(tmpdir(), 'g5-'));
      mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, 'src', 'a.ts'), 'a');
      writeFileSync(join(root, 'package.json'), '{}');
      return root;
    };
    const record = (dir: string, source: string, android = true, ios = true) => writeFileSync(join(dir, 'faz-5-derleme.json'), JSON.stringify({ source, at: 'x', android: { ok: android, seconds: 90, tail: '' }, ios: { ok: ios, seconds: 120, tail: '' } }));
    const gate = phase5Gates.find((g) => g.id === 'K5.4')!;

    it('fails without a record and with a stale one', async () => {
      const root = repo();
      const dir = mkdtempSync(join(tmpdir(), 'g5r-'));
      expect((await gate.measure(ctxWith(() => ({ code: 0, out: '' }), dir, root).ctx)).status).toBe('fail');
      record(dir, 'old');
      expect(await gate.measure(ctxWith(() => ({ code: 0, out: '' }), dir, root).ctx)).toMatchObject({ status: 'fail', measured: expect.stringContaining('eski') });
    });

    it('passes with a fresh record of two good builds and fails when one platform failed', async () => {
      const root = repo();
      const dir = mkdtempSync(join(tmpdir(), 'g5r-'));
      record(dir, sourceHash(root));
      expect(await gate.measure(ctxWith(() => ({ code: 0, out: '' }), dir, root).ctx)).toMatchObject({ status: 'pass', measured: 'android tamam (90 sn), ios tamam (120 sn)' });
      record(dir, sourceHash(root), true, false);
      expect(await gate.measure(ctxWith(() => ({ code: 0, out: '' }), dir, root).ctx)).toMatchObject({ status: 'fail', measured: 'android tamam (90 sn), ios hata (120 sn)' });
    });
  });

  describe('K5.7 device report', () => {
    const write = (dir: string, name: string, value: DeviceReport) => writeFileSync(join(dir, `cihaz-${name}.json`), JSON.stringify(value));
    const ios = phase5Gates.find((g) => g.id === 'K5.7')!;
    const android = phase5Gates.find((g) => g.id === 'K5.7b')!;

    it('passes for a Release iPhone report where every test passed and the speed is recorded', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'g5d-'));
      write(dir, 'a', report('iOS 26.6', 'release', allPass(), '131'));
      expect(await ios.measure(ctxWith(() => ({ code: 0, out: '' }), dir).ctx)).toMatchObject({ status: 'pass', measured: 'rapor iOS 26.6-1; arama p95 131 ms' });
    });

    it('fails and names what is missing or not passing, and ignores Debug reports', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'g5d-'));
      write(dir, 'debug', report('iOS 26.6', 'debug', allPass()));
      expect((await ios.measure(ctxWith(() => ({ code: 0, out: '' }), dir).ctx)).measured).toContain('Release raporu yok');
      write(dir, 'bad', report('iOS 26.6', 'release', { ...allPass(), 'sdk.search-speed': 'fail', 'sdk.q-map': 'fail', 'sdk.q-dark': undefined as never }, '226'));
      const result = await ios.measure(ctxWith(() => ({ code: 0, out: '' }), dir).ctx);
      expect(result.status).toBe('fail');
      expect(result.measured).toContain('sdk.search-speed');
      expect(result.measured).toContain('sdk.q-map');
    });

    it('keeps the Android gate open without a report and fails the iOS one', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'g5d-'));
      expect((await android.measure(ctxWith(() => ({ code: 0, out: '' }), dir).ctx)).status).toBe('open');
      expect((await ios.measure(ctxWith(() => ({ code: 0, out: '' }), dir).ctx)).status).toBe('fail');
    });

    it('needs an info record for the memory test and the border question', () => {
      const entries = allPass();
      delete entries['sdk.memory'];
      expect(missingFor(report('iOS 26', 'release', entries))).toEqual(['sdk.memory']);
    });
  });

  it('exits with a failure when a gate fails', async () => {
    const { ctx } = ctxWith(() => ({ code: 1, out: 'bad' }));
    expect(exitCodeFor(await runGates(phase5Gates, ctx))).toBe(1);
  });
});
