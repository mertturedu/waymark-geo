import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix6Gates } from '../../gates/fix-6';

const dir = () => mkdtempSync(join(tmpdir(), 'f6-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix6Gates.find((g) => g.id === id)!;

describe('fix 6 gates', () => {
  it('runs jest and then pytest and fails on either', async () => {
    const calls: string[] = [];
    const run = async (cmd: string) => {
      calls.push(cmd);
      return { code: 0, out: cmd === 'npx' ? 'Tests: 90 passed' : '9 passed in 0.2s' };
    };
    const result = await gate('KF6.1').measure({ reportDir: '.', repoRoot: '.', run });
    expect(calls).toEqual(['npx', 'sh']);
    expect(result).toEqual({ status: 'pass', measured: '90 passed; pytest 9 passed' });
    const jestFails = await gate('KF6.1').measure({ reportDir: '.', repoRoot: '.', run: async () => ({ code: 1, out: 'boom' }) });
    expect(jestFails.status).toBe('fail');
    const pytestFails = await gate('KF6.1').measure({ reportDir: '.', repoRoot: '.', run: async (cmd) => (cmd === 'npx' ? { code: 0, out: 'Tests: 1 passed' } : { code: 1, out: '1 failed' }) });
    expect(pytestFails.status).toBe('fail');
  });

  it('keeps the comparison, device, performance and size gates open without evidence', async () => {
    for (const id of ['KF6.2', 'KF6.3', 'KF6.4', 'KF6.5']) expect((await gate(id).measure(ctx(dir()))).status).toBe('open');
  });

  it('judges the colour targets from the newest full run', async () => {
    const d = dir();
    const day = join(d, 'harita-karsilastirma', '2026-11-06');
    mkdirSync(join(day, 'apple'), { recursive: true });
    const write = (checks: unknown[]) => writeFileSync(join(day, 'ozet.json'), JSON.stringify({ rows: [{}], checks }));
    write([{ name: 'Zemin ΔE açık', ok: true }, { name: 'Bina alan payı', ok: true }, { name: 'Sokak adı', ok: false }]);
    expect((await gate('KF6.2').measure(ctx(d))).status).toBe('pass');
    write([{ name: 'Zemin ΔE açık', ok: false }]);
    expect((await gate('KF6.2').measure(ctx(d))).status).toBe('fail');
  });

  it('passes the cleanliness gate on empty output', async () => {
    expect((await gate('KF6.6').measure(ctx(dir()))).status).toBe('pass');
    expect((await gate('KF6.6').measure(ctx(dir(), 'x: izli', 1))).status).toBe('fail');
  });
});
