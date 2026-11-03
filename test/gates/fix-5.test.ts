import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix5Gates, fontChoice } from '../../gates/fix-5';

const dir = () => mkdtempSync(join(tmpdir(), 'f5-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix5Gates.find((g) => g.id === id)!;

describe('fix 5 gates', () => {
  it('waits for the font choice and accepts only inter or noto', async () => {
    const d = dir();
    expect((await gate('KF5.5').measure(ctx(d))).status).toBe('open');
    mkdirSync(join(d, 'fix-5-kararlar'));
    const file = join(d, 'fix-5-kararlar', 'yazi-tipi.json');
    writeFileSync(file, JSON.stringify({ choice: 'comic' }));
    expect(fontChoice(d)).toBeNull();
    writeFileSync(file, 'not json');
    expect(fontChoice(d)).toBeNull();
    writeFileSync(file, JSON.stringify({ choice: 'inter', note: 'Kadıköy' }));
    expect(fontChoice(d)).toEqual({ choice: 'inter', note: 'Kadıköy' });
    expect((await gate('KF5.5').measure(ctx(d))).measured).toContain('inter');
    expect((await gate('KF5.5').measure(ctx(d))).status).toBe('pass');
  });

  it('judges the comparison targets from the newest full run', async () => {
    const d = dir();
    expect((await gate('KF5.2').measure(ctx(d))).status).toBe('open');
    const day = join(d, 'harita-karsilastirma', '2026-11-05');
    mkdirSync(join(day, 'apple'), { recursive: true });
    const write = (checks: unknown[]) => writeFileSync(join(day, 'ozet.json'), JSON.stringify({ rows: [{}], checks }));
    write([{ name: 'Sokak adı görünme oranı', ok: true }, { name: '3 satırlık ad', ok: true }, { name: 'Çakışan yazı', ok: true }, { name: 'Zemin ΔE', ok: false }]);
    expect((await gate('KF5.2').measure(ctx(d))).status).toBe('pass');
    write([{ name: 'Sokak adı görünme oranı', ok: false }]);
    expect((await gate('KF5.2').measure(ctx(d))).status).toBe('fail');
    write([{ name: 'Sokak adı görünme oranı', ok: null }]);
    expect((await gate('KF5.2').measure(ctx(d))).status).toBe('open');
    write([{ name: 'Zemin ΔE', ok: true }]);
    expect((await gate('KF5.2').measure(ctx(d))).status).toBe('open');
  });

  it('keeps the device and performance gates open without reports', async () => {
    expect((await gate('KF5.3').measure(ctx(dir()))).status).toBe('open');
    expect((await gate('KF5.4').measure(ctx(dir()))).status).toBe('open');
  });

  it('passes the unit and cleanliness gates on exit code and output', async () => {
    expect((await gate('KF5.1').measure(ctx(dir(), 'Tests: 120 passed', 0))).measured).toBe('120 passed');
    expect((await gate('KF5.1').measure(ctx(dir(), 'boom', 1))).status).toBe('fail');
    expect((await gate('KF5.6').measure(ctx(dir()))).status).toBe('pass');
    expect((await gate('KF5.6').measure(ctx(dir(), 'x: izli', 1))).status).toBe('fail');
  });
});
