import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fix9Gates, sdkCheckFile, sdkCheckResult, versionProblems } from '../../gates/fix-9';

const dir = () => mkdtempSync(join(tmpdir(), 'f9-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix9Gates.find((g) => g.id === id)!;

const files = (over: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = {
    '/r/package.json': '{"version":"0.5.0"}',
    '/r/src/core/create-geo.ts': "export const SDK_VERSION = '0.5.0';",
    '/r/CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n## 0.5.0\n\n- x\n',
    '/r/README.md': 'x',
    '/r/docs/licences.md': 'x',
    ...over,
  };
  return (path: string) => base[path] ?? null;
};

describe('versionProblems', () => {
  it('finds nothing when the version, the constant, the changelog and the documents agree', () => {
    expect(versionProblems('/r', files())).toEqual([]);
  });

  it('names each thing that is off', () => {
    expect(versionProblems('/r', files({ '/r/package.json': '{"version":"0.4.0"}' }))).toEqual(['package.json sürümü 0.4.0']);
    expect(versionProblems('/r', files({ '/r/src/core/create-geo.ts': "export const SDK_VERSION = '0.4.0';" }))).toEqual(['SDK_VERSION 0.5.0 değil']);
    expect(versionProblems('/r', files({ '/r/docs/licences.md': null }))).toEqual(['docs/licences.md yok']);
    expect(versionProblems('/r', files({ '/r/CHANGELOG.md': '# Changelog\n\n## 0.4.0\n' }))).toEqual(['CHANGELOG.md\'de "## 0.5.0" başlığı yok']);
    expect(versionProblems('/r', files({ '/r/CHANGELOG.md': '# Changelog\n\n## Unreleased\n\n- yeni madde\n\n## 0.5.0\n' }))).toEqual(['CHANGELOG.md hâlâ "Unreleased" altında madde taşıyor']);
    expect(versionProblems('/r', files({ '/r/package.json': null }))).toContain('package.json sürümü ?');
  });
});

describe('fix 9 gates', () => {
  it('reads the two Expo records and needs both', async () => {
    const d = dir();
    expect(sdkCheckResult(d, '57')).toBeNull();
    expect((await gate('KF9.2').measure(ctx(d))).measured).toContain('57, 58');
    writeFileSync(sdkCheckFile(d, '57'), JSON.stringify({ pass: true, measured: 'ok' }));
    expect((await gate('KF9.2').measure(ctx(d))).status).toBe('open');
    writeFileSync(sdkCheckFile(d, '58'), JSON.stringify({ pass: true, measured: 'ok' }));
    expect(await gate('KF9.2').measure(ctx(d))).toEqual({ status: 'pass', measured: 'Expo 57: geçti; Expo 58: geçti' });
    writeFileSync(sdkCheckFile(d, '58'), JSON.stringify({ pass: false, measured: 'x' }));
    expect((await gate('KF9.2').measure(ctx(d))).status).toBe('fail');
    writeFileSync(sdkCheckFile(d, '58'), 'bozuk');
    expect(sdkCheckResult(d, '58')).toBeNull();
  });

  it('runs the package tests for the export gate', async () => {
    expect(await gate('KF9.1').measure(ctx('.', 'Tests: 21 passed', 0))).toEqual({ status: 'pass', measured: '21 passed' });
    expect((await gate('KF9.1').measure(ctx('.', 'boom', 1))).status).toBe('fail');
  });

  it('keeps the real Android phone gate open without a report and allows it to stay open', async () => {
    const result = await gate('KF9.4').measure(ctx(dir()));
    expect(result.status).toBe('open');
    expect(gate('KF9.4').allowOpen).toBe(true);
  });

  it('passes the cleanliness gate on empty output', async () => {
    expect((await gate('KF9.5').measure(ctx('.'))).status).toBe('pass');
    expect((await gate('KF9.5').measure(ctx('.', 'x: izli', 1))).status).toBe('fail');
  });
});
