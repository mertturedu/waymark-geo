import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGates, type GateContext } from '../../gates/engine';
import { phase7Gates, PLAN_MUTATION_CONFIG } from '../../gates/phase-7';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }, reportDir = mkdtempSync(join(tmpdir(), 'g7-'))) => {
  const calls: Call[] = [];
  const ctx: GateContext = { reportDir, repoRoot: mkdtempSync(join(tmpdir(), 'g7r-')), run: async (cmd, args) => (calls.push({ cmd, args }), answer({ cmd, args })) };
  return { ctx, calls, reportDir };
};

describe('phase 7 gates', () => {
  it('lists the gates of the plan in order and lets only the device and decision gates stay open', () => {
    expect(phase7Gates.map((g) => g.id)).toEqual(['K7.1', 'K7.2', 'K7.3', 'K7.4', 'K7.5', 'K7.6', 'K7.7', 'K7.8', 'K7.9', 'K7.10', 'K7.11', 'K7.12', 'K7.13', 'K7.14', 'K7.15']);
    expect(phase7Gates.every((g) => g.phase === 7)).toBe(true);
    expect(phase7Gates.filter((g) => g.allowOpen).map((g) => g.id)).toEqual(['K7.11', 'K7.14', 'K7.15']);
    expect(PLAN_MUTATION_CONFIG).toBe('stryker.plan.config.json');
  });

  it('reads the summary line of the plan measurement', async () => {
    const { ctx, calls } = ctxWith((call) => ({ code: 0, out: `noise\n{"check":"${call.args[3]}","pass":true,"measured":"ölçüm ${call.args[3]}"}\n` }));
    const [k71] = await runGates(phase7Gates.filter((g) => g.id === 'K7.1'), ctx);
    expect(calls[0]?.args).toEqual(['tsx', 'scripts/measure-plan.ts', '--check', 'exact']);
    expect(k71).toMatchObject({ status: 'pass', measured: 'ölçüm exact' });
  });

  it('fails a gate when the measurement exits with an error', async () => {
    const { ctx } = ctxWith(() => ({ code: 1, out: '{"check":"exact","pass":false,"measured":"3 örnek tutmadı"}' }));
    const [k71] = await runGates(phase7Gates.filter((g) => g.id === 'K7.1'), ctx);
    expect(k71).toMatchObject({ status: 'fail', measured: '3 örnek tutmadı' });
  });

  it('leaves the reference gates open until the OR-Tools output exists', async () => {
    const { ctx } = ctxWith(() => ({ code: 0, out: '' }));
    const results = await runGates(phase7Gates.filter((g) => g.id === 'K7.2' || g.id === 'K7.8'), ctx);
    expect(results.map((r) => r.status)).toEqual(['open', 'open']);
  });

  it('leaves the device gates open without a Release report', async () => {
    const { ctx } = ctxWith(() => ({ code: 0, out: '' }));
    const results = await runGates(phase7Gates.filter((g) => g.id === 'K7.11' || g.id === 'K7.15'), ctx);
    expect(results.map((r) => r.status)).toEqual(['open', 'open']);
  });

  it('uses the newest Release report that holds the ids, not simply the newest report', async () => {
    const { ctx, reportDir } = ctxWith(() => ({ code: 0, out: '' }));
    const report = (reportId: string, entries: { id: string; outcome: string }[]) => ({ reportId, generatedAt: '2026-11-03T00:00:00Z', device: { model: 'iPhone121', os: 'iOS 26.0' }, sdk: { version: '0.4.0', dataVersion: null, build: 'release' }, entries: entries.map((e) => ({ ...e, title: e.id, kind: 'auto' })) });
    writeFileSync(join(reportDir, 'cihaz-a-20261101-000000.json'), JSON.stringify(report('a-20261101-000000', [{ id: 'sdk.offline-search', outcome: 'pass' }])));
    writeFileSync(join(reportDir, 'cihaz-z-20261103-000000.json'), JSON.stringify(report('z-20261103-000000', [{ id: 'sdk.map-open', outcome: 'pass' }])));
    const [k715] = await runGates(phase7Gates.filter((g) => g.id === 'K7.15'), ctx);
    expect(k715?.status).toBe('pass');
    writeFileSync(join(reportDir, 'cihaz-b-20261102-000000.json'), JSON.stringify(report('b-20261102-000000', [{ id: 'sdk.offline-search', outcome: 'fail' }])));
    const [again] = await runGates(phase7Gates.filter((g) => g.id === 'K7.15'), ctx);
    expect(again?.status).toBe('fail');
  });

  it('reads the chain position report for the big cities and the tile check', async () => {
    const { ctx, reportDir } = ctxWith(() => ({ code: 0, out: '' }));
    writeFileSync(join(reportDir, 'zincir-konum-denetimi.md'), ['| 34 | 1000 | 100 | 880 | 20 | 0 |', '| 06 | 500 | 50 | 430 | 20 | 0 |', 'Toplam 1500 nokta; kanıtlı pay %88.4 (eşik en az %97.0).', 'Karo gidiş-dönüş: 300 örnekte en büyük sapma 0.43 m (eşik en çok 1.0 m), karoda bulunamayan 0.'].join('\n'));
    const [k714] = await runGates(phase7Gates.filter((g) => g.id === 'K7.14'), ctx);
    expect(k714?.status).toBe('pass');
    expect(k714?.measured).toContain('0.43 m');
  });
});
