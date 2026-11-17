import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSteps, readBuildReport, runBuildCheck, sourceHash, type BuildRunner } from '../../scripts/check-builds';

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'cb-'));
  for (const [path, text] of Object.entries({ 'src/a.ts': 'a', 'src/native/b.ts': 'b', 'example/src/App.tsx': 'app', 'example/app.config.js': 'cfg', 'example/package.json': '{}', 'package.json': '{}', 'test/ignored.ts': 'x', 'example/ios/Pods/x.h': 'x' })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

describe('sourceHash', () => {
  it('changes when a shipped or example source file changes and not for tests or generated folders', () => {
    const root = tree();
    const first = sourceHash(root);
    writeFileSync(join(root, 'test/ignored.ts'), 'changed');
    writeFileSync(join(root, 'example/ios/Pods/x.h'), 'changed');
    expect(sourceHash(root)).toBe(first);
    writeFileSync(join(root, 'src/native/b.ts'), 'changed');
    expect(sourceHash(root)).not.toBe(first);
    const second = sourceHash(root);
    writeFileSync(join(root, 'example/src/App.tsx'), 'changed');
    expect(sourceHash(root)).not.toBe(second);
  });
});

describe('buildSteps', () => {
  it('prepares and builds Android with Gradle and iOS without signing, for a device', () => {
    const steps = buildSteps('/repo', { javaHome: '/jdk' });
    expect(steps.map((s) => s.name)).toEqual(['android hazırlık', 'android derleme', 'ios derleme']);
    const gradle = steps[1];
    expect(gradle?.cmd).toBe('./gradlew');
    expect(gradle?.args).toEqual(['assembleDebug']);
    expect(gradle?.env.JAVA_HOME).toBe('/jdk');
    expect(gradle?.cwd).toBe('/repo/example/android');
    const ios = steps[2];
    expect(ios?.cmd).toBe('xcodebuild');
    expect(ios?.args).toEqual(expect.arrayContaining(['-destination', 'generic/platform=iOS', 'CODE_SIGNING_ALLOWED=NO', 'build']));
  });

  it('never asks for a release build, a bundle, an EAS build or an install on a device', () => {
    const joined = buildSteps('/repo', { javaHome: '/jdk' }).map((s) => `${s.cmd} ${s.args.join(' ')}`).join('\n');
    expect(joined).not.toMatch(/assembleRelease|bundleRelease|\beas\b|run:android|run:ios|adb /i);
    expect(joined).not.toContain('-configuration Release');
  });
});

describe('runBuildCheck', () => {
  const runner = (failAt: string | null): { run: BuildRunner; calls: string[] } => {
    const calls: string[] = [];
    return { calls, run: async (step) => (calls.push(step.name), step.name === failAt ? { code: 1, out: 'derleme hatası' } : { code: 0, out: 'ok' }) };
  };

  it('writes a report with the source hash and per platform results', async () => {
    const root = tree();
    const reports = mkdtempSync(join(tmpdir(), 'cbr-'));
    const { run, calls } = runner(null);
    const report = await runBuildCheck({ repoRoot: root, reportDir: reports, run, javaHome: '/jdk' });
    expect(calls).toEqual(['android hazırlık', 'android derleme', 'ios derleme']);
    expect(report).toMatchObject({ source: sourceHash(root), android: { ok: true }, ios: { ok: true } });
    expect(JSON.parse(readFileSync(join(reports, 'faz-5-derleme.json'), 'utf8'))).toMatchObject({ source: sourceHash(root) });
    expect(readBuildReport(reports)).toMatchObject({ android: { ok: true }, ios: { ok: true } });
  });

  it('keeps going to iOS after an Android failure and records both', async () => {
    const root = tree();
    const reports = mkdtempSync(join(tmpdir(), 'cbr-'));
    const { run, calls } = runner('android derleme');
    const report = await runBuildCheck({ repoRoot: root, reportDir: reports, run, javaHome: '/jdk' });
    expect(calls).toEqual(['android hazırlık', 'android derleme', 'ios derleme']);
    expect(report.android.ok).toBe(false);
    expect(report.android.tail).toContain('derleme hatası');
    expect(report.ios.ok).toBe(true);
  });

  it('reads nothing from a folder without a report or with a damaged one', () => {
    const reports = mkdtempSync(join(tmpdir(), 'cbr-'));
    expect(readBuildReport(reports)).toBeNull();
    writeFileSync(join(reports, 'faz-5-derleme.json'), '{bad');
    expect(readBuildReport(reports)).toBeNull();
  });
});
