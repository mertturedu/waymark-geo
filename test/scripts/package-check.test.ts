import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appFiles, packageCheckSteps, runPackageCheck, type Runner } from '../../scripts/package-check';

const paths = { repoRoot: '/repo', work: '/work', exampleRoot: '/repo/example' };

describe('packageCheckSteps', () => {
  const steps = packageCheckSteps(paths);

  it('runs the checks of K5.3 in order', () => {
    expect(steps.map((s) => s.name)).toEqual(['kur', 'tip denetimi', 'android paketi', 'ios paketi', 'prebuild']);
  });

  it('works inside the temporary app', () => {
    for (const step of steps) expect(step.cwd).toBe('/work/app');
  });

  it('asks Expo for the two platforms and for a native project without installing pods', () => {
    const joined = steps.map((s) => `${s.cmd} ${s.args.join(' ')}`);
    expect(joined[1]).toBe('npx tsc --noEmit');
    expect(joined[2]).toContain('expo export --platform android');
    expect(joined[3]).toContain('expo export --platform ios');
    expect(joined[4]).toContain('expo prebuild');
    expect(joined[4]).toContain('--no-install');
  });
});

describe('appFiles', () => {
  const files = appFiles({ exampleDependencies: { expo: '^57.0.0', react: '19.2.3' }, exampleDevDependencies: { typescript: '~6.0.3' }, bare: '/work/geo.git' });

  it('takes the example dependencies and the SDK from the bare repository', () => {
    const pkg = JSON.parse(files['package.json'] as string) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.expo).toBe('^57.0.0');
    expect(pkg.dependencies['@yuksi/geo']).toBe('git+file:///work/geo.git');
  });

  it('brings the compiler and the React types along', () => {
    const pkg = JSON.parse(files['package.json'] as string) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies.typescript).toBe('~6.0.3');
    expect(JSON.parse(appFiles({ exampleDependencies: {}, bare: '/b' })['package.json'] as string).devDependencies).toEqual({});
  });

  it('lists the SDK plugin and gives both platforms an identifier', () => {
    const app = JSON.parse(files['app.json'] as string) as { expo: { plugins: string[]; ios: { bundleIdentifier: string }; android: { package: string } } };
    expect(app.expo.plugins).toEqual(['@yuksi/geo']);
    expect(app.expo.ios.bundleIdentifier).toMatch(/^com\./);
    expect(app.expo.android.package).toMatch(/^com\./);
  });

  it('imports the public entry points the way an app would', () => {
    expect(files['App.tsx']).toContain("from '@yuksi/geo/native'");
    expect(files['App.tsx']).toContain("from '@yuksi/geo'");
  });
});

describe('runPackageCheck', () => {
  function rig(failAt: string | null = null) {
    const calls: string[] = [];
    const run: Runner = async (step) => {
      calls.push(step.name);
      return step.name === failAt ? { code: 1, out: 'boom: something broke' } : { code: 0, out: 'ok' };
    };
    return { calls, run };
  }

  it('prepares the bare repository and the app, then runs every step', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pc-'));
    const { calls, run } = rig();
    const report = await runPackageCheck({ repoRoot: join(__dirname, '../..'), work, run });
    expect(report.ok).toBe(true);
    expect(calls).toEqual(['kur', 'tip denetimi', 'android paketi', 'ios paketi', 'prebuild']);
    expect(existsSync(join(work, 'geo.git'))).toBe(true);
    expect(existsSync(join(work, 'app', 'App.tsx'))).toBe(true);
    expect(JSON.parse(readFileSync(join(work, 'app', 'package.json'), 'utf8')).dependencies['@yuksi/geo']).toBe(`git+file://${join(work, 'geo.git')}`);
  }, 60_000);

  it('stops at the first failing step and reports its output', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pc-'));
    const { calls, run } = rig('tip denetimi');
    const report = await runPackageCheck({ repoRoot: join(__dirname, '../..'), work, run });
    expect(report.ok).toBe(false);
    expect(calls).toEqual(['kur', 'tip denetimi']);
    expect(report.steps.at(-1)).toMatchObject({ name: 'tip denetimi', ok: false });
    expect(report.steps.at(-1)?.tail).toContain('boom');
  }, 60_000);

  it('does not copy tests, the example app or data into the bare repository', async () => {
    const work = mkdtempSync(join(tmpdir(), 'pc-'));
    await runPackageCheck({ repoRoot: join(__dirname, '../..'), work, run: rig().run });
    const listing = (await import('node:child_process')).execFileSync('git', ['--git-dir', join(work, 'geo.git'), 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).split('\n');
    expect(listing).toContain('package.json');
    expect(listing).toContain('app.plugin.js');
    expect(listing.some((f) => f.startsWith('src/native/index.ts'))).toBe(true);
    for (const bad of ['test/', 'example/', 'dist/', 'pipeline/', 'fixtures/', 'node_modules/']) expect(listing.some((f) => f.startsWith(bad))).toBe(false);
  }, 60_000);
});
