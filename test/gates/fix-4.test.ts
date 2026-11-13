import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix4Gates, latestFullRun, phoneGap } from '../../gates/fix-4';

const dir = () => mkdtempSync(join(tmpdir(), 'f4-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix4Gates.find((g) => g.id === id)!;

describe('fix 4 gates', () => {
  it('opens the phone gate until the gap file exists, then judges the mean SSIM', async () => {
    const d = dir();
    expect((await gate('KF4.2').measure(ctx(d))).status).toBe('open');
    mkdirSync(join(d, 'harita-karsilastirma'));
    const file = join(d, 'harita-karsilastirma', 'telefon-fark.json');
    writeFileSync(file, JSON.stringify({ spots: [{ ssim: 0.9 }, { ssim: 0.8 }] }));
    expect(phoneGap(d)).toEqual({ ssim: expect.closeTo(0.85, 5), spots: 2 });
    expect((await gate('KF4.2').measure(ctx(d))).status).toBe('pass');
    writeFileSync(file, JSON.stringify({ spots: [{ ssim: 0.5 }] }));
    expect((await gate('KF4.2').measure(ctx(d))).status).toBe('fail');
  });

  it('finds the newest run that has a summary with rows', async () => {
    const d = dir();
    const root = join(d, 'harita-karsilastirma');
    mkdirSync(join(root, '2026-11-01'), { recursive: true });
    writeFileSync(join(root, '2026-11-01', 'ozet.json'), JSON.stringify({ rows: [{}, {}], checks: [{ name: 'a', ok: true }, { name: 'b', ok: false }] }));
    mkdirSync(join(root, '2026-11-02'), { recursive: true });
    writeFileSync(join(root, '2026-11-02', 'ozet.json'), JSON.stringify({ rows: [] }));
    expect(latestFullRun(d)?.dir).toBe(join(root, '2026-11-01'));
    const result = await gate('KF4.3').measure(ctx(d));
    expect(result.status).toBe('open');
    expect(result.measured).toContain('2 karşılaştırma, 1/2 hedef');
  });

  it('opens the report gate with no run', async () => {
    expect((await gate('KF4.3').measure(ctx(dir()))).status).toBe('open');
  });

  it('passes the tool test and cleanliness gates on exit code and output', async () => {
    expect((await gate('KF4.1').measure(ctx(dir(), 'ℹ pass 37', 0))).measured).toBe('37 test geçti');
    expect((await gate('KF4.1').measure(ctx(dir(), 'boom', 1))).status).toBe('fail');
    expect((await gate('KF4.4').measure(ctx(dir()))).status).toBe('pass');
    expect((await gate('KF4.4').measure(ctx(dir(), 'x: izli dosya', 1))).status).toBe('fail');
  });
});
