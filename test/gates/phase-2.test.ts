import { runGates, type GateContext } from '../../gates/engine';
import { phase2Gates } from '../../gates/phase-2';

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

const ok = (check: string) => ({ code: 0, out: `noise line\n{"check":"${check}","pass":true,"measured":"ölçüm ${check}"}\n` });

describe('phase 2 gates', () => {
  it('lists the gates of the plan in order', () => {
    expect(phase2Gates.map((g) => g.id)).toEqual(['K2.1', 'K2.2', 'K2.3', 'K2.3b', 'K2.4', 'K2.5', 'K2.6', 'K2.7']);
    expect(phase2Gates.every((g) => g.phase === 2 && g.kind === 'auto')).toBe(true);
  });

  it('asks the measurement script for each check and reports what it printed', async () => {
    const { ctx, calls } = ctxWith((call) => ok(call.args[call.args.length - 1] as string));
    const results = await runGates(phase2Gates, ctx);
    expect(results.map((r) => r.status)).toEqual(Array(8).fill('pass'));
    expect(calls.map((c) => c.args[c.args.length - 1])).toEqual(['determinism', 'accounting', 'assignment', 'hoods', 'counts', 'sizes', 'borders', 'tiles']);
    expect(calls.every((c) => c.args.includes('scripts/measure-packs.ts') && c.args.includes('--check'))).toBe(true);
    expect(results[2]?.measured).toBe('ölçüm assignment');
  });

  it('fails a gate when its measurement fails and keeps the numbers', async () => {
    const { ctx } = ctxWith((call) => (call.args.includes('counts') ? { code: 1, out: '{"check":"counts","pass":false,"measured":"80 paket kuruldu"}\n' } : ok('x')));
    const results = await runGates(phase2Gates, ctx);
    const counts = results.find((r) => r.id === 'K2.4');
    expect(counts).toMatchObject({ status: 'fail', measured: '80 paket kuruldu' });
    expect(results.filter((r) => r.status === 'fail')).toHaveLength(1);
  });

  it('shows the tail of the output when nothing parseable came back', async () => {
    const { ctx } = ctxWith(() => ({ code: 1, out: 'Error: dist/packs yok\n' }));
    const [first] = await runGates(phase2Gates, ctx);
    expect(first).toMatchObject({ status: 'fail' });
    expect(first?.measured).toContain('dist/packs yok');
  });
});
