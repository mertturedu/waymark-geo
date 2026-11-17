import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exitCodeFor, runGates, type GateContext } from '../../gates/engine';
import { phase6Gates, ROUTE_MUTATION_CONFIG } from '../../gates/phase-6';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }, reportDir = mkdtempSync(join(tmpdir(), 'g6-'))) => {
  const calls: Call[] = [];
  const ctx: GateContext = { reportDir, repoRoot: '/repo', run: async (cmd, args) => (calls.push({ cmd, args }), answer({ cmd, args })) };
  return { ctx, calls };
};

const measured = (call: Call): { code: number; out: string } => ({ code: 0, out: `noise\n{"check":"${call.args[3]}","pass":true,"measured":"ölçüm ${call.args[3]}"}\n` });

describe('phase 6 gates', () => {
  it('lists the gates of the plan in order and keeps only the Mapbox run open-able', () => {
    expect(phase6Gates.map((g) => g.id)).toEqual(['K6.1', 'K6.2', 'K6.3', 'K6.4', 'K6.5', 'K6.6', 'K6.7', 'K6.8', 'K6.8b', 'K6.9', 'K6.10']);
    expect(phase6Gates.every((g) => g.phase === 6)).toBe(true);
    expect(phase6Gates.filter((g) => g.allowOpen).map((g) => g.id)).toEqual(['K6.6']);
  });

  it('asks the measurement script for each rule and reads its summary line', async () => {
    const { ctx, calls } = ctxWith(measured);
    const results = await runGates(phase6Gates.filter((g) => g.id !== 'K6.6' && g.id !== 'K6.10'), ctx);
    expect(calls.map((c) => c.args[3])).toEqual(['exact', 'reference', 'oneway', 'turns', 'connectivity', 'snapping', 'sizes', 'speed', 'hermes', 'memory']);
    expect(results.every((r) => r.status === 'pass')).toBe(true);
    expect(results.find((r) => r.id === 'K6.1')?.measured).toBe('ölçüm exact');
    expect(results.find((r) => r.id === 'K6.5')?.measured).toBe('bağlılık: ölçüm connectivity; oturtma: ölçüm snapping');
  });

  it('fails K6.5 when either half fails and shows the tail of a failed run', async () => {
    const { ctx } = ctxWith((call) => (call.args[3] === 'snapping' ? { code: 1, out: 'a\nb\nc\nd' } : measured(call)));
    const [k65] = await runGates(phase6Gates.filter((g) => g.id === 'K6.5'), ctx);
    expect(k65?.status).toBe('fail');
    expect(k65?.measured).toContain('b / c / d');
  });

  it('leaves the Mapbox gate open without a report, passes with one that says so, fails otherwise', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'g6-report-'));
    const gate = phase6Gates.find((g) => g.id === 'K6.6')!;
    const { ctx } = ctxWith(measured, dir);
    expect((await runGates([gate], ctx))[0]?.status).toBe('open');
    expect(exitCodeFor(await runGates([gate], ctx))).toBe(0);
    writeFileSync(join(dir, 'faz-6-mapbox-karsilastirma.md'), 'En çok yüzde 15 yavaş olan çift oranı: yüzde 97,0\nSONUÇ: GEÇTİ\n');
    const pass = (await runGates([gate], ctx))[0];
    expect(pass).toMatchObject({ status: 'pass', measured: 'En çok yüzde 15 yavaş olan çift oranı: yüzde 97,0' });
    writeFileSync(join(dir, 'faz-6-mapbox-karsilastirma.md'), 'En çok yüzde 15 yavaş olan çift oranı: yüzde 80,0\nSONUÇ: GEÇMEDİ\n');
    expect((await runGates([gate], ctx))[0]?.status).toBe('fail');
  });

  it('runs mutation on the route files and the coverage thresholds for K6.10', async () => {
    const { ctx, calls } = ctxWith((call) => ({ code: 0, out: call.args[0] === 'stryker' ? 'All files | 88.20 |' : 'ok' }));
    const [k610] = await runGates(phase6Gates.filter((g) => g.id === 'K6.10'), ctx);
    expect(calls[0]?.args).toEqual(['stryker', 'run', ROUTE_MUTATION_CONFIG]);
    expect(calls[1]?.args).toEqual(['jest', '--coverage', '--silent']);
    expect(k610).toMatchObject({ status: 'pass', measured: 'rota mutasyonu 88.20; kapsam eşikleri geçti' });
    const { ctx: failing } = ctxWith((call) => ({ code: call.args[0] === 'stryker' ? 1 : 0, out: 'x' }));
    expect((await runGates(phase6Gates.filter((g) => g.id === 'K6.10'), failing))[0]?.status).toBe('fail');
  });
});
