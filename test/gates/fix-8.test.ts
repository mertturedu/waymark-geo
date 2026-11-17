import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix8Gates } from '../../gates/fix-8';

const dir = () => mkdtempSync(join(tmpdir(), 'f8-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix8Gates.find((g) => g.id === id)!;
const IDS = ['sdk.place-card', 'sdk.compass', 'sdk.nearby', 'sdk.maneuvers'];

function report(d: string, name: string, model: string, outcomes: Record<string, string>) {
  mkdirSync(join(d, 'cihaz'), { recursive: true });
  const body = { reportId: name, generatedAt: '2026-11-04T00:00:00Z', device: { model, os: 'iOS 27.0' }, sdk: { version: '0.4.0', dataVersion: null, build: 'release' }, entries: Object.entries(outcomes).map(([id, outcome]) => ({ id, title: id, kind: 'auto', outcome })) };
  writeFileSync(join(d, 'cihaz', `cihaz-${name}.json`), JSON.stringify(body));
}

describe('fix 8 gates', () => {
  it('runs jest for the unit gate and the language gate and fails when it fails', async () => {
    expect(await gate('KF8.1').measure(ctx('.', 'Tests: 500 passed', 0))).toEqual({ status: 'pass', measured: '500 passed' });
    expect((await gate('KF8.1').measure(ctx('.', 'boom', 1))).status).toBe('fail');
    expect((await gate('KF8.4').measure(ctx('.', '', 0))).status).toBe('pass');
    expect((await gate('KF8.4').measure(ctx('.', 'missing key', 1))).measured).toBe('missing key');
  });

  it('needs the four device tests on the simulator and on the phone', async () => {
    const d = dir();
    expect((await gate('KF8.2').measure(ctx(d))).status).toBe('open');
    report(d, 'arm64-sim-1', 'arm64-sim', Object.fromEntries(IDS.map((id) => [id, 'pass'])));
    const half = await gate('KF8.2').measure(ctx(d));
    expect(half.status).toBe('open');
    expect(half.measured).toContain('iPhone: rapor yok');
    report(d, 'iPhone121-1', 'iPhone121', Object.fromEntries(IDS.map((id) => [id, 'pass'])));
    expect((await gate('KF8.2').measure(ctx(d))).status).toBe('pass');
  });

  it('fails when the simulator run has a failing test and keeps performance open', async () => {
    const d = dir();
    report(d, 'arm64-sim-2', 'arm64-sim', { ...Object.fromEntries(IDS.map((id) => [id, 'pass'])), 'sdk.compass': 'fail' });
    expect((await gate('KF8.2').measure(ctx(d))).status).toBe('fail');
    expect((await gate('KF8.3').measure(ctx(d))).status).toBe('open');
    writeFileSync(join(d, 'fix-3-sonuc.json'), '{}');
    expect((await gate('KF8.3').measure(ctx(d))).measured).toContain('perf koşusu bekleniyor');
  });

  it('passes the cleanliness gate on empty output', async () => {
    expect((await gate('KF8.5').measure(ctx('.'))).status).toBe('pass');
    expect((await gate('KF8.5').measure(ctx('.', 'x: izli', 1))).status).toBe('fail');
  });
});
