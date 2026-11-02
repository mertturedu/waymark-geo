import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Step = { name: string; cmd: string; args: string[]; cwd: string; env: Record<string, string> };
export type StepResult = { name: string; ok: boolean; ms: number; tail: string };
export type Runner = (step: Step) => Promise<{ code: number; out: string }>;
export type CheckReport = { ok: boolean; steps: StepResult[] };

const SHIPPED = ['package.json', 'app.plugin.js', 'README.md', 'src'];
const TAIL = 1200;
const CLONE_ATTEMPTS = 4;

export function packageCheckSteps(paths: { repoRoot: string; work: string; exampleRoot: string }): Step[] {
  const cwd = join(paths.work, 'app');
  const env = { CI: '1', EXPO_NO_TELEMETRY: '1' };
  return [
    { name: 'kur', cmd: 'npm', args: ['install', '--no-audit', '--no-fund', '--prefer-offline'], cwd, env },
    { name: 'tip denetimi', cmd: 'npx', args: ['tsc', '--noEmit'], cwd, env },
    { name: 'android paketi', cmd: 'npx', args: ['expo', 'export', '--platform', 'android', '--output-dir', 'out-android'], cwd, env },
    { name: 'ios paketi', cmd: 'npx', args: ['expo', 'export', '--platform', 'ios', '--output-dir', 'out-ios'], cwd, env },
    { name: 'prebuild', cmd: 'npx', args: ['expo', 'prebuild', '--no-install', '--clean', '--platform', 'all'], cwd, env },
  ];
}

export function appFiles(input: { exampleDependencies: Record<string, string>; exampleDevDependencies?: Record<string, string>; bare: string }): Record<string, string> {
  const pkg = { name: 'geo-package-check', version: '1.0.0', private: true, main: 'index.js', dependencies: { ...input.exampleDependencies, '@yuksi/geo': `git+file://${input.bare}` }, devDependencies: input.exampleDevDependencies ?? {} };
  const app = { expo: { name: 'Geo Paket Denetimi', slug: 'geo-package-check', version: '1.0.0', plugins: ['@yuksi/geo'], ios: { bundleIdentifier: 'com.example.geocheck' }, android: { package: 'com.example.geocheck' } } };
  return {
    'package.json': JSON.stringify(pkg, null, 2),
    'app.json': JSON.stringify(app, null, 2),
    'tsconfig.json': JSON.stringify({ extends: 'expo/tsconfig.base', compilerOptions: { strict: true, noEmit: true } }, null, 2),
    'index.js': "import { registerRootComponent } from 'expo';\nimport App from './App';\n\nregisterRootComponent(App);\n",
    'App.tsx': [
      "import { createGeo, type Geo } from '@yuksi/geo';",
      "import { GeoAttribution, GeoProvider, RegionDownloadSheet, useAttribution, useAutoRegion, useGeo, useMapStyle } from '@yuksi/geo/native';",
      "import { Text, View } from 'react-native';",
      '',
      'const keep: [typeof createGeo, Geo | null] = [createGeo, null];',
      '',
      'function Inner() {',
      '  const geo = useGeo();',
      '  const style = useMapStyle({ theme: "light" });',
      '  const auto = useAutoRegion([28.97, 41.0]);',
      '  const attribution = useAttribution();',
      '  return (',
      '    <View>',
      '      <Text>{Object.keys(style.sources).length + auto.decision.action + geo.regions.installed().length + keep.length}</Text>',
      '      <GeoAttribution state={attribution.state} onToggle={attribution.toggle} />',
      '      <RegionDownloadSheet visible={false} onClose={() => undefined} />',
      '    </View>',
      '  );',
      '}',
      '',
      'export default function App() {',
      '  return (',
      '    <GeoProvider config={{ manifestUrl: "https://example.org/manifest-v1.json", publicKeys: [] }}>',
      '      <Inner />',
      '    </GeoProvider>',
      '  );',
      '}',
      '',
    ].join('\n'),
  };
}

function prepareBare(repoRoot: string, work: string): string {
  const staged = join(work, 'repo');
  mkdirSync(staged, { recursive: true });
  for (const name of SHIPPED) cpSync(join(repoRoot, name), join(staged, name), { recursive: true });
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: staged, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.name=Mert Turedu1', '-c', 'user.email=mert.turedu1@example.com', 'commit', '-q', '-m', 'ilk surum');
  const bare = join(work, 'geo.git');
  for (let attempt = 1; ; attempt++) {
    rmSync(bare, { recursive: true, force: true });
    try {
      execFileSync('git', ['clone', '-q', '--bare', staged, bare], { stdio: 'ignore' });
      execFileSync('git', ['--git-dir', bare, 'fsck', '--connectivity-only'], { stdio: 'ignore' });
      return bare;
    } catch (error) {
      if (attempt >= CLONE_ATTEMPTS) throw error;
    }
  }
}

const defaultRunner: Runner = (step) =>
  new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { cwd: step.cwd, env: { ...process.env, ...step.env } });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20 * 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });

export async function runPackageCheck(input: { repoRoot: string; work: string; run?: Runner }): Promise<CheckReport> {
  const run = input.run ?? defaultRunner;
  const exampleRoot = join(input.repoRoot, 'example');
  const bare = prepareBare(input.repoRoot, input.work);
  const example = JSON.parse(readFileSync(join(exampleRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
  const app = join(input.work, 'app');
  mkdirSync(app, { recursive: true });
  for (const [name, text] of Object.entries(appFiles({ exampleDependencies: example.dependencies, ...(example.devDependencies ? { exampleDevDependencies: example.devDependencies } : {}), bare }))) writeFileSync(join(app, name), `${text}\n`);
  const steps: StepResult[] = [];
  for (const step of packageCheckSteps({ repoRoot: input.repoRoot, work: input.work, exampleRoot })) {
    const started = Date.now();
    const result = await run(step);
    steps.push({ name: step.name, ok: result.code === 0, ms: Date.now() - started, tail: result.out.slice(-TAIL) });
    if (result.code !== 0) return { ok: false, steps };
  }
  return { ok: true, steps };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const keep = process.argv.includes('--keep');
  const work = mkdtempSync(join(tmpdir(), 'geo-package-check-'));
  runPackageCheck({ repoRoot, work }).then((report) => {
    for (const step of report.steps) console.log(`${step.ok ? 'tamam' : 'HATA'} ${step.name} (${Math.round(step.ms / 1000)} sn)${step.ok ? '' : `\n${step.tail}`}`);
    console.log(JSON.stringify({ check: 'sdk', pass: report.ok, measured: report.steps.map((s) => `${s.name}:${s.ok ? 'ok' : 'hata'}`).join(' ') }));
    if (!keep) rmSync(work, { recursive: true, force: true });
    else console.log(`çalışma klasörü: ${work}`);
    process.exit(report.ok ? 0 : 1);
  });
}
