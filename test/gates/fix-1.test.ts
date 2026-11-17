import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deviceGate, isIos27, isSimulator, repeatGate } from '../../gates/fix-1';
import { fix2Gates, isAndroid } from '../../gates/fix-2';
import type { DeviceReport } from '../../src/core/report/types';

const report = (id: string, model: string, os: string, entries: [string, 'pass' | 'fail'][]): DeviceReport => ({
  reportId: id,
  createdAt: id,
  device: { model, os },
  sdk: { version: '0.4.0', dataVersion: null, build: 'release' },
  entries: entries.map(([entry, outcome]) => ({ id: entry, title: entry, kind: 'auto', outcome })),
});

describe('fix 1 gates', () => {
  it('tells simulators and iOS 27 apart', () => {
    expect(isSimulator(report('a', 'arm64-sim', 'iOS 27.1', []))).toBe(true);
    expect(isSimulator(report('a', 'iPhone12,1', 'iOS 26.1', []))).toBe(false);
    expect(isIos27(report('a', 'x', 'iOS 27.1', []))).toBe(true);
    expect(isIos27(report('a', 'x', 'iOS 27', []))).toBe(true);
    expect(isIos27(report('a', 'x', 'iOS 270', []))).toBe(false);
    expect(isIos27(report('a', 'x', 'iOS 26.4', []))).toBe(false);
  });

  it('passes, fails or stays open by the newest matching report', () => {
    const sim = report('s', 'arm64-sim', 'iOS 27.1', [['sdk.map-open', 'pass']]);
    expect(deviceGate([sim], ['sdk.map-open'], isSimulator, 'sim').status).toBe('pass');
    expect(deviceGate([report('s', 'arm64-sim', 'iOS 27.1', [['sdk.map-open', 'fail']])], ['sdk.map-open'], isSimulator, 'sim').status).toBe('fail');
    expect(deviceGate([sim], ['sdk.map-open'], (r) => !isSimulator(r), 'phone').status).toBe('open');
  });

  it('needs every repeat to pass', () => {
    const all = Array.from({ length: 10 }, (_, i) => [i === 0 ? 'sdk.map-cargo' : `sdk.map-cargo#${i + 1}`, 'pass'] as [string, 'pass']);
    expect(repeatGate([report('r', 'm', 'o', all)], 'sdk.map-cargo', 10)).toMatchObject({ status: 'pass', measured: 'r: 10/10' });
    const one = all.map(([id], i) => [id, i === 4 ? 'fail' : 'pass'] as [string, 'pass' | 'fail']);
    expect(repeatGate([report('r', 'm', 'o', one)], 'sdk.map-cargo', 10)).toMatchObject({ status: 'fail', measured: 'r: 9/10' });
    expect(repeatGate([report('r', 'm', 'o', all.slice(0, 9))], 'sdk.map-cargo', 10).status).toBe('open');
  });
});

describe('fix 2 gates', () => {
  const ids = ['sdk.auto-location', 'sdk.cellular-consent', 'sdk.locate-cycle'];
  const all = (id: string, model: string, os: string, outcome: 'pass' | 'fail' = 'pass') => report(id, model, os, ids.map((entry) => [entry, outcome] as [string, 'pass' | 'fail']));
  const gate = fix2Gates.find((g) => g.id === 'KF2.2')!;
  const ctx = (reports: DeviceReport[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'fix2-'));
    mkdirSync(join(dir, 'cihaz'));
    reports.forEach((r, i) => writeFileSync(join(dir, 'cihaz', `cihaz-r${i}.json`), JSON.stringify(r)));
    return { reportDir: dir, repoRoot: '/', run: async () => ({ code: 0, out: '' }) };
  };

  it('knows an Android emulator report', () => {
    expect(isAndroid(report('a', 'sdk_gphone64_arm64-sim', 'Android 17', []))).toBe(true);
    expect(isAndroid(report('a', 'arm64-sim', 'iOS 27.0', []))).toBe(false);
  });

  it('needs the iOS 27 simulator, the Android emulator and the iPhone, each with all three tests', async () => {
    const ios = all('s', 'arm64-sim', 'iOS 27.0');
    const android = all('a', 'sdk_gphone64_arm64-sim', 'Android 17');
    const phone = all('p', 'iPhone12,1', 'iOS 26.6');
    expect((await gate.measure(ctx([ios, android, phone]))).status).toBe('pass');
    expect((await gate.measure(ctx([ios, phone]))).status).toBe('open');
    expect((await gate.measure(ctx([ios, android, all('p', 'iPhone12,1', 'iOS 26.6', 'fail')]))).status).toBe('fail');
  });
});
