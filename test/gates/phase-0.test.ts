import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGates, type GateContext } from '../../gates/engine';
import { phase0Gates } from '../../gates/phase-0';
import { formatReport } from '../../src/core/report/format';
import type { DeviceReport } from '../../src/core/report/types';
import { sampleReport } from '../report/fixtures';

type Call = { cmd: string; args: string[] };

const setup = (code = 0) => {
  const reportDir = mkdtempSync(join(tmpdir(), 'geo-gates-'));
  const calls: Call[] = [];
  const ctx: GateContext = {
    reportDir,
    repoRoot: '/repo',
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      return { code, out: code === 0 ? 'ok' : 'failed' };
    },
  };
  return { reportDir, calls, ctx };
};

const statusOf = async (ctx: GateContext, id: string) => {
  const results = await runGates(phase0Gates, ctx);
  const found = results.find((r) => r.id === id);
  if (!found) throw new Error(`no gate ${id}`);
  return found;
};

const writeDecision = (dir: string, n: number, result: string) => {
  mkdirSync(join(dir, 'faz-0-kararlar'), { recursive: true });
  writeFileSync(join(dir, 'faz-0-kararlar', `D${n}.json`), JSON.stringify({ id: `D${n}`, result, summary: 'özet', evidence: ['kanıt'] }));
};

const writeDeviceReport = (dir: string, os: string, build: 'release' | 'debug', outcome: 'pass' | 'fail' = 'pass') => {
  const report: DeviceReport = sampleReport();
  report.device.os = os;
  report.sdk.build = build;
  report.reportId = `r-${os}-${build}-${outcome}`.replace(/\s/g, '');
  report.entries = [
    { id: 'd1.map-offline', title: 'harita', kind: 'manual', outcome },
    { id: 'd1.net-state', title: 'ağ', kind: 'auto', outcome: 'pass' },
  ];
  writeFileSync(join(dir, `cihaz-${report.reportId}.json`), JSON.stringify(report));
  return formatReport(report);
};

describe('phase 0 gates', () => {
  it('lists the planned gate ids', () => {
    expect(phase0Gates.map((g) => g.id)).toEqual(['K0.1', 'K0.2', ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `K0.3-D${n}`), 'K0.4a', 'K0.4b', 'K0.5']);
    expect(phase0Gates.find((g) => g.id === 'K0.4b')?.allowOpen).toBe(true);
  });

  it('K0.1 runs npm run verify and follows its exit code', async () => {
    const ok = setup(0);
    expect((await statusOf(ok.ctx, 'K0.1')).status).toBe('pass');
    expect(ok.calls).toContainEqual({ cmd: 'npm', args: ['run', 'verify'] });
    expect((await statusOf(setup(1).ctx, 'K0.1')).status).toBe('fail');
  });

  it('K0.2 runs the clean check and its own test', async () => {
    const { ctx, calls } = setup(0);
    expect((await statusOf(ctx, 'K0.2')).status).toBe('pass');
    expect(calls).toContainEqual({ cmd: 'node', args: ['../tools/geo-clean-check.mjs', '.'] });
    expect(calls).toContainEqual({ cmd: 'node', args: ['--test', '../tools/geo-clean-check.test.mjs'] });
    expect((await statusOf(setup(1).ctx, 'K0.2')).status).toBe('fail');
  });

  it('K0.5 runs the report tests', async () => {
    const { ctx, calls } = setup(0);
    expect((await statusOf(ctx, 'K0.5')).status).toBe('pass');
    expect(calls).toContainEqual({ cmd: 'npx', args: ['jest', 'test/report'] });
  });

  it('K0.3 decision gates fail without evidence, follow the result otherwise', async () => {
    const { ctx, reportDir } = setup();
    expect(await statusOf(ctx, 'K0.3-D1')).toMatchObject({ status: 'fail', measured: expect.stringContaining('kanıt yok') });
    writeDecision(reportDir, 1, 'evet');
    expect((await statusOf(ctx, 'K0.3-D1')).status).toBe('pass');
    writeDecision(reportDir, 2, 'hayir');
    expect(await statusOf(ctx, 'K0.3-D2')).toMatchObject({ status: 'fail', measured: expect.stringContaining('plan değişikliği gerekir') });
  });

  it('K0.3 treats a malformed decision file as failed', async () => {
    const { ctx, reportDir } = setup();
    mkdirSync(join(reportDir, 'faz-0-kararlar'), { recursive: true });
    writeFileSync(join(reportDir, 'faz-0-kararlar', 'D3.json'), '{not json');
    expect((await statusOf(ctx, 'K0.3-D3')).status).toBe('fail');
  });

  it('K0.4a needs a passing iOS release report', async () => {
    const { ctx, reportDir } = setup();
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('fail');
    writeDeviceReport(reportDir, 'iOS 26.0', 'debug');
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('fail');
    writeDeviceReport(reportDir, 'iOS 26.0', 'release', 'fail');
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('fail');
    writeDeviceReport(reportDir, 'iOS 26.0', 'release');
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('pass');
  });

  it('K0.4b stays open without an Android report and passes with one', async () => {
    const { ctx, reportDir } = setup();
    expect((await statusOf(ctx, 'K0.4b')).status).toBe('open');
    writeDeviceReport(reportDir, 'iOS 26.0', 'release');
    expect((await statusOf(ctx, 'K0.4b')).status).toBe('open');
    writeDeviceReport(reportDir, 'Android 16', 'release');
    expect((await statusOf(ctx, 'K0.4b')).status).toBe('pass');
  });

  it('ignores unreadable device report files', async () => {
    const { ctx, reportDir } = setup();
    writeFileSync(join(reportDir, 'cihaz-bozuk.json'), 'nope');
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('fail');
  });

  it('K0.3 fails when the decision file carries another id', async () => {
    const { reportDir, ctx } = setup();
    mkdirSync(join(reportDir, 'faz-0-kararlar'), { recursive: true });
    writeFileSync(join(reportDir, 'faz-0-kararlar', 'D7.json'), JSON.stringify({ id: 'D1', result: 'evet', summary: 'özet', evidence: ['kanıt'] }));
    const gate = await statusOf(ctx, 'K0.3-D7');
    expect(gate.status).toBe('fail');
    expect(gate.measured).toContain('does not match');
  });

  it('K0.4a skips a broken report and still finds the valid one next to it', async () => {
    const { reportDir, ctx } = setup();
    writeFileSync(join(reportDir, 'cihaz-bozuk.json'), JSON.stringify({ entries: [], device: {}, sdk: { build: 'release' } }));
    writeDeviceReport(reportDir, 'iOS 26.6', 'release');
    expect((await statusOf(ctx, 'K0.4a')).status).toBe('pass');
  });

  it('K0.4b stays open when the report folder does not exist yet', async () => {
    const { ctx } = setup();
    const missing = { ...ctx, reportDir: join(ctx.reportDir, 'henuz-yok') };
    expect((await statusOf(missing, 'K0.4b')).status).toBe('open');
  });
});
