import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exitCodeFor, runGates, type GateContext } from '../../gates/engine';
import { phase3Gates } from '../../gates/phase-3';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }, reportDir = mkdtempSync(join(tmpdir(), 'k3-'))) => {
  const calls: Call[] = [];
  const ctx: GateContext = {
    reportDir,
    repoRoot: '/repo',
    run: async (cmd, args) => {
      const call = { cmd, args };
      calls.push(call);
      return answer(call);
    },
  };
  return { ctx, calls };
};

const ok = (check: string) => ({ code: 0, out: `noise\n{"check":"${check}","pass":true,"measured":"ölçüm ${check}"}\n` });

describe('phase 3 gates', () => {
  it('lists the gates of the plan in order', () => {
    expect(phase3Gates.map((g) => g.id)).toEqual(['K3.1', 'K3.2', 'K3.3', 'K3.4', 'K3.5', 'K3.6', 'K3.7', 'K3.8', 'K3.9', 'K3.10', 'K3.11', 'K3.12', 'K3.13', 'K3.14']);
    expect(phase3Gates.every((g) => g.phase === 3)).toBe(true);
  });

  it('asks the measurement script for the check of each gate', async () => {
    const { ctx, calls } = ctxWith((call) => ok(call.args[call.args.length - 1] as string));
    const results = await runGates(phase3Gates, ctx);
    expect(calls.map((c) => c.args[c.args.length - 1])).toEqual(['full', 'folded', 'typo', 'numbered', 'predict', 'reverse', 'label', 'places', 'languages', 'oracle', 'speed', 'fuzz', 'regions-all']);
    expect(calls.every((c) => c.args.includes('scripts/measure-address.ts') && c.args.includes('--check'))).toBe(true);
    expect(results.find((r) => r.id === 'K3.6')).toMatchObject({ status: 'pass', measured: 'ölçüm reverse' });
  });

  it('fails a gate when its measurement fails and keeps the numbers', async () => {
    const { ctx } = ctxWith((call) => (call.args.includes('speed') ? { code: 1, out: '{"check":"speed","pass":false,"measured":"resolve p95 18 ms"}\n' } : ok('x')));
    const results = await runGates(phase3Gates, ctx);
    expect(results.find((r) => r.id === 'K3.11')).toMatchObject({ status: 'fail', measured: 'resolve p95 18 ms' });
    expect(results.filter((r) => r.status === 'fail')).toHaveLength(1);
    expect(exitCodeFor(results)).toBe(1);
  });

  it('shows the tail of the output when nothing parseable came back', async () => {
    const { ctx } = ctxWith(() => ({ code: 1, out: 'Error: dist/packs yok\n' }));
    const [first] = await runGates(phase3Gates, ctx);
    expect(first).toMatchObject({ status: 'fail' });
    expect(first?.measured).toContain('dist/packs yok');
  });

  it('leaves the Mapbox report open until it exists and never fails the phase for it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'k3m-'));
    const { ctx } = ctxWith((call) => ok(call.args[call.args.length - 1] as string), dir);
    const before = await runGates(phase3Gates, ctx);
    expect(before.find((r) => r.id === 'K3.13')).toMatchObject({ status: 'open', allowOpen: true });
    expect(exitCodeFor(before)).toBe(0);
    writeFileSync(join(dir, 'faz-3-mapbox-karsilastirma.md'), 'rapor');
    const after = await runGates(phase3Gates, ctx);
    expect(after.find((r) => r.id === 'K3.13')).toMatchObject({ status: 'pass' });
  });
});
