import { exitCodeFor, runGates, type GateContext } from '../../gates/engine';
import { phase4Gates } from '../../gates/phase-4';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }) => {
  const calls: Call[] = [];
  const ctx: GateContext = {
    reportDir: '/tmp',
    repoRoot: '/repo',
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      return answer({ cmd, args });
    },
  };
  return { ctx, calls };
};

const measured = (check: string) => ({ code: 0, out: `noise\n{"check":"${check}","pass":true,"measured":"ölçüm ${check}"}\n` });

describe('phase 4 gates', () => {
  it('lists the gates of the plan in order', () => {
    expect(phase4Gates.map((g) => g.id)).toEqual(['K4.1', 'K4.2', 'K4.3', 'K4.4', 'K4.4b', 'K4.5', 'K4.6', 'K4.7', 'K4.8', 'K4.9', 'K4.10']);
    expect(phase4Gates.every((g) => g.phase === 4 && g.kind === 'auto')).toBe(true);
  });

  it('asks the measurement script for the six measured gates and jest for the four rule gates', async () => {
    const { ctx, calls } = ctxWith((call) => (call.cmd === 'npx' && call.args[0] === 'tsx' ? measured(call.args[call.args.length - 1] as string) : { code: 0, out: 'Tests:       12 passed, 12 total\nAll files | 88.12 |\n' }));
    const results = await runGates(phase4Gates, ctx);
    const scripted = calls.filter((c) => c.args[0] === 'tsx');
    expect(scripted.map((c) => c.args[c.args.length - 1])).toEqual(['delivery1', 'delivery3', 'delivery5', 'outlier', 'pin', 'sparse']);
    expect(scripted.every((c) => c.args.includes('scripts/measure-learning.ts'))).toBe(true);
    expect(calls.filter((c) => c.args[0] === 'jest' && !c.args.includes('--coverage')).map((c) => c.args.slice(1))).toEqual([
      ['test/learn/trust.test.ts'],
      ['test/learn/persistence.test.ts'],
      ['test/learn/corrections.test.ts', 'test/scripts/corrections.test.ts'],
      ['test/learn/privacy.test.ts'],
    ]);
    expect(results.find((r) => r.id === 'K4.6')).toMatchObject({ status: 'pass', measured: '12 passed, 12 total' });
    expect(results.find((r) => r.id === 'K4.2')).toMatchObject({ status: 'pass', measured: 'ölçüm delivery3' });
  });

  it('measures mutation on the learning folder only and reads the score', async () => {
    const { ctx, calls } = ctxWith(() => ({ code: 0, out: 'All files |  88.12 |  88.12 |\n' }));
    const results = await runGates(phase4Gates, ctx);
    const mutation = calls.find((c) => c.args.includes('stryker'));
    expect(mutation?.args).toEqual(['stryker', 'run', '--mutate', 'src/core/learn/**/*.ts']);
    expect(results.find((r) => r.id === 'K4.10')).toMatchObject({ status: 'pass', measured: 'mutasyon 88.12; kapsam eşikleri geçti' });
  });

  it('fails the mutation gate when the score is under the break line or coverage fails', async () => {
    const below = ctxWith((call) => (call.args.includes('stryker') ? { code: 1, out: 'All files |  71.00 |\n' } : { code: 0, out: 'ok' }));
    expect((await runGates(phase4Gates, below.ctx)).find((r) => r.id === 'K4.10')).toMatchObject({ status: 'fail', measured: 'mutasyon 71.00; kapsam eşikleri geçti' });
    const thin = ctxWith((call) => (call.args.includes('--coverage') ? { code: 1, out: 'threshold' } : { code: 0, out: 'All files | 90.00 |' }));
    expect((await runGates(phase4Gates, thin.ctx)).find((r) => r.id === 'K4.10')).toMatchObject({ status: 'fail', measured: 'mutasyon 90.00; kapsam eşikleri tutmadı' });
  });

  it('fails a measured gate and keeps its numbers', async () => {
    const { ctx } = ctxWith((call) => (call.args.includes('delivery3') ? { code: 1, out: '{"check":"delivery3","pass":false,"measured":"ortanca 11 m"}\n' } : measured('x')));
    const results = await runGates(phase4Gates, ctx);
    expect(results.find((r) => r.id === 'K4.2')).toMatchObject({ status: 'fail', measured: 'ortanca 11 m' });
    expect(exitCodeFor(results)).toBe(1);
  });

  it('shows the tail of the output when nothing parseable came back', async () => {
    const { ctx } = ctxWith(() => ({ code: 1, out: 'Error: dist/packs yok\n' }));
    const [first, , , , , , jestGate] = await runGates(phase4Gates, ctx);
    expect(first?.measured).toContain('dist/packs yok');
    expect(jestGate).toMatchObject({ status: 'fail' });
    expect(jestGate?.measured).toContain('dist/packs yok');
  });
});
