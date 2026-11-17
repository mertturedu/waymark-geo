import { runGates, type GateContext } from '../../gates/engine';
import { phase1Gates } from '../../gates/phase-1';

type Call = { cmd: string; args: string[] };

const ctxWith = (answer: (call: Call) => { code: number; out: string }) => {
  const calls: Call[] = [];
  const ctx: GateContext = {
    reportDir: '/tmp/none',
    repoRoot: '/repo',
    run: async (cmd, args) => {
      const call = { cmd, args };
      calls.push(call);
      return answer(call);
    },
  };
  return { ctx, calls };
};

const ok = { code: 0, out: '{"check":"x","pass":true,"measured":"1809/1809"}\n' };

describe('phase 1 gates', () => {
  it('lists K1.1 to K1.6 for phase 1', () => {
    expect(phase1Gates.map((g) => g.id)).toEqual(['K1.1', 'K1.2', 'K1.3', 'K1.4', 'K1.5', 'K1.6']);
    expect(phase1Gates.every((g) => g.phase === 1)).toBe(true);
  });

  it('runs the measurements and reports their numbers', async () => {
    const { ctx, calls } = ctxWith((call) => (call.args.includes('mutation') ? { code: 0, out: 'Final mutation score of 91.25 is greater than or equal to break threshold 80' } : ok));
    const results = await runGates(phase1Gates, ctx);
    expect(results.map((r) => r.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    expect(results[0]?.measured).toBe('1809/1809');
    expect(results[3]?.measured).toContain('91.25');
    const joined = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    expect(joined).toEqual(
      expect.arrayContaining([
        expect.stringContaining('measure-text.ts --check golden'),
        expect.stringContaining('jest test/text/properties.test.ts'),
        expect.stringContaining('measure-text.ts --check speed'),
        expect.stringContaining('measure-text.ts --check fuzz'),
        expect.stringContaining('measure-text.ts --check k15'),
        expect.stringContaining('hermes-golden.ts'),
        expect.stringContaining('mutation'),
        expect.stringContaining('--coverage'),
      ]),
    );
  });

  it.each(['K1.1', 'K1.2', 'K1.3', 'K1.4', 'K1.5', 'K1.6'])('fails %s when its command fails', async (id) => {
    const { ctx } = ctxWith(() => ({ code: 1, out: '{"check":"x","pass":false,"measured":"3/10"}\nboom' }));
    const results = await runGates(phase1Gates.filter((g) => g.id === id), ctx);
    expect(results[0]?.status).toBe('fail');
    expect(results[0]?.measured).not.toBe('');
  });

  it('fails K1.3 when only one of speed and fuzz fails', async () => {
    const { ctx } = ctxWith((call) => (call.args.includes('fuzz') ? { code: 1, out: '{"measured":"2 hata"}' } : ok));
    const results = await runGates(phase1Gates.filter((g) => g.id === 'K1.3'), ctx);
    expect(results[0]?.status).toBe('fail');
    expect(results[0]?.measured).toContain('2 hata');
  });

  it('fails K1.4 when the coverage run fails even if mutation passes', async () => {
    const { ctx } = ctxWith((call) => (call.args.includes('--coverage') ? { code: 1, out: 'coverage threshold' } : { code: 0, out: 'Final mutation score of 90 is' }));
    const results = await runGates(phase1Gates.filter((g) => g.id === 'K1.4'), ctx);
    expect(results[0]?.status).toBe('fail');
  });
});
