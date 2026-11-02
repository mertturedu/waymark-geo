import { exitCodeFor, renderGateTable, runGates, type Gate, type GateContext } from '../../gates/engine';

const ctx: GateContext = { reportDir: '/tmp/none', repoRoot: '/tmp/none', run: async () => ({ code: 0, out: '' }) };

const gate = (over: Partial<Gate> & Pick<Gate, 'id'>): Gate => ({
  phase: 0,
  title: 'Başlık',
  kind: 'auto',
  threshold: 'eşik',
  measure: async () => ({ status: 'pass', measured: 'ok' }),
  ...over,
});

describe('runGates', () => {
  it('returns one result per gate with its measurement', async () => {
    const results = await runGates([gate({ id: 'A' }), gate({ id: 'B', measure: async () => ({ status: 'fail', measured: '3 ms' }) })], ctx);
    expect(results.map((r) => [r.id, r.status, r.measured])).toEqual([
      ['A', 'pass', 'ok'],
      ['B', 'fail', '3 ms'],
    ]);
  });

  it('turns a throwing measurement into a failed gate with the message', async () => {
    const results = await runGates([gate({ id: 'A', measure: async () => { throw new Error('boom'); } })], ctx);
    expect(results[0]).toMatchObject({ status: 'fail', measured: 'boom' });
  });

  it('carries allowOpen into the result', async () => {
    const results = await runGates([gate({ id: 'A', allowOpen: true }), gate({ id: 'B' })], ctx);
    expect(results.map((r) => r.allowOpen)).toEqual([true, false]);
  });
});

describe('exitCodeFor', () => {
  const result = (status: 'pass' | 'fail' | 'open', allowOpen: boolean) => ({ id: 'x', title: 't', kind: 'auto' as const, threshold: '', measured: '', status, allowOpen });

  it('is 0 when everything passed', () => {
    expect(exitCodeFor([result('pass', false)])).toBe(0);
  });

  it('is 1 for any failed gate', () => {
    expect(exitCodeFor([result('pass', false), result('fail', true)])).toBe(1);
  });

  it('allows an open gate only when it is marked allowOpen', () => {
    expect(exitCodeFor([result('open', true)])).toBe(0);
    expect(exitCodeFor([result('open', false)])).toBe(1);
  });
});

describe('renderGateTable', () => {
  it('lists every gate id, threshold and a Turkish status label', async () => {
    const results = await runGates([gate({ id: 'K0.1', threshold: 'verify 0' }), gate({ id: 'K0.2', measure: async () => ({ status: 'fail', measured: 'x' }) }), gate({ id: 'K0.4b', allowOpen: true, measure: async () => ({ status: 'open', measured: '-' }) })], ctx);
    const table = renderGateTable(results);
    ['K0.1', 'K0.2', 'K0.4b', 'verify 0', 'GEÇTİ', 'KALDI', 'AÇIK'].forEach((text) => expect(table).toContain(text));
  });

  it('escapes pipes and line breaks inside cells', async () => {
    const results = await runGates([gate({ id: 'A', measure: async () => ({ status: 'pass', measured: 'a|b\nc' }) })], ctx);
    expect(renderGateTable(results)).toContain('a\\|b c');
  });
});
