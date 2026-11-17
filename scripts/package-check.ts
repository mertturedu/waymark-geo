import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Step = { name: string; cmd: string; args: string[]; cwd: string; env: Record<string, string> };
export type StepResult = { name: string; ok: boolean; ms: number; tail: string };
export type Runner = (step: Step) => Promise<{ code: number; out: string }>;
export type CheckReport = { ok: boolean; steps: StepResult[] };

export function tarballName(output: string): string {
  const name = (JSON.parse(output.slice(output.indexOf('[')).trim()) as { filename?: string }[])[0]?.filename;
  if (!name) throw new Error('npm pack dosya adı vermedi');
  return name;
}

export function packTarball(repoRoot: string, work: string): string {
  mkdirSync(work, { recursive: true });
  const out = execFileSync('npm', ['pack', '--json', '--pack-destination', work], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return join(work, tarballName(out));
}
const TAIL = 1200;

export function packageCheckSteps(paths: { repoRoot: string; work: string; exampleRoot: string }, options: { expo?: string } = {}): Step[] {
  const cwd = join(paths.work, 'app');
  const env = { CI: '1', EXPO_NO_TELEMETRY: '1' };
  return [
    { name: 'kur', cmd: 'npm', args: ['install', '--no-audit', '--no-fund', '--prefer-offline'], cwd, env },
    ...(options.expo ? [{ name: `expo ${options.expo} uyumu`, cmd: 'npx', args: ['expo', 'install', `expo@${options.expo}`, '--', '--no-audit', '--no-fund'], cwd, env }, { name: 'sürüm düzeltme', cmd: 'npx', args: ['expo', 'install', '--fix', '--', '--no-audit', '--no-fund'], cwd, env }] : []),
    { name: 'tip denetimi', cmd: 'npx', args: ['tsc', '--noEmit'], cwd, env },
    { name: 'android paketi', cmd: 'npx', args: ['expo', 'export', '--platform', 'android', '--output-dir', 'out-android'], cwd, env },
    { name: 'ios paketi', cmd: 'npx', args: ['expo', 'export', '--platform', 'ios', '--output-dir', 'out-ios'], cwd, env },
    { name: 'prebuild', cmd: 'npx', args: ['expo', 'prebuild', '--no-install', '--clean', '--platform', 'all'], cwd, env },
  ];
}

export function appFiles(input: { exampleDependencies: Record<string, string>; exampleDevDependencies?: Record<string, string>; bare?: string; tarball?: string }): Record<string, string> {
  const source = input.tarball ? `file:${input.tarball}` : `git+file://${input.bare ?? ''}`;
  const pkg = { name: 'geo-package-check', version: '1.0.0', private: true, main: 'index.js', dependencies: { ...input.exampleDependencies, '@yuksi/geo': source }, devDependencies: input.exampleDevDependencies ?? {} };
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

export async function runPackageCheck(input: { repoRoot: string; work: string; run?: Runner; expo?: string; pack?: (repoRoot: string, work: string) => string }): Promise<CheckReport> {
  const run = input.run ?? defaultRunner;
  const exampleRoot = join(input.repoRoot, 'example');
  const tarball = (input.pack ?? packTarball)(input.repoRoot, join(input.work, 'tarball'));
  const example = JSON.parse(readFileSync(join(exampleRoot, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
  const app = join(input.work, 'app');
  mkdirSync(app, { recursive: true });
  for (const [name, text] of Object.entries(appFiles({ exampleDependencies: example.dependencies, ...(example.devDependencies ? { exampleDevDependencies: example.devDependencies } : {}), tarball }))) writeFileSync(join(app, name), `${text}\n`);
  const steps: StepResult[] = [];
  for (const step of packageCheckSteps({ repoRoot: input.repoRoot, work: input.work, exampleRoot }, { ...(input.expo ? { expo: input.expo } : {}) })) {
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
  const expoAt = process.argv.indexOf('--expo');
  const expo = expoAt >= 0 ? process.argv[expoAt + 1] : undefined;
  runPackageCheck({ repoRoot, work, ...(expo ? { expo } : {}) }).then((report) => {
    for (const step of report.steps) console.log(`${step.ok ? 'tamam' : 'HATA'} ${step.name} (${Math.round(step.ms / 1000)} sn)${step.ok ? '' : `\n${step.tail}`}`);
    console.log(JSON.stringify({ check: 'sdk', pass: report.ok, measured: report.steps.map((s) => `${s.name}:${s.ok ? 'ok' : 'hata'}`).join(' ') }));
    if (!keep) rmSync(work, { recursive: true, force: true });
    else console.log(`çalışma klasörü: ${work}`);
    process.exit(report.ok ? 0 : 1);
  });
}
