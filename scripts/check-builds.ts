import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultReportDir } from './device-report';

export type BuildStep = { name: string; cmd: string; args: string[]; cwd: string; env: Record<string, string> };
export type BuildRunner = (step: BuildStep) => Promise<{ code: number; out: string }>;
export type PlatformResult = { ok: boolean; seconds: number; tail: string };
export type BuildReport = { source: string; at: string; android: PlatformResult; ios: PlatformResult };

const REPORT_FILE = 'faz-5-derleme.json';
const SOURCE_ROOTS = ['src', 'example/src', 'example/app.config.js', 'example/package.json', 'package.json', 'app.plugin.cjs'];
const TAIL = 1500;

function listFiles(path: string, out: string[]): void {
  if (!existsSync(path)) return;
  if (!statSync(path).isDirectory()) {
    out.push(path);
    return;
  }
  for (const name of readdirSync(path).sort()) listFiles(join(path, name), out);
}

export function sourceHash(repoRoot: string): string {
  const files: string[] = [];
  for (const entry of SOURCE_ROOTS) listFiles(join(repoRoot, entry), files);
  const hash = createHash('sha256');
  for (const file of files) hash.update(relative(repoRoot, file)).update('\0').update(readFileSync(file)).update('\0');
  return hash.digest('hex');
}

export function buildSteps(repoRoot: string, options: { javaHome: string }): BuildStep[] {
  const example = join(repoRoot, 'example');
  const env = { CI: '1', JAVA_HOME: options.javaHome };
  return [
    { name: 'android hazırlık', cmd: 'npx', args: ['expo', 'prebuild', '--platform', 'android', '--no-install'], cwd: example, env },
    { name: 'android derleme', cmd: './gradlew', args: ['assembleDebug'], cwd: join(example, 'android'), env },
    {
      name: 'ios derleme',
      cmd: 'xcodebuild',
      args: ['-workspace', 'GeoOrnek.xcworkspace', '-scheme', 'GeoOrnek', '-configuration', 'Debug', '-destination', 'generic/platform=iOS', '-derivedDataPath', join(repoRoot, 'dist', 'ios-build-check'), 'CODE_SIGNING_ALLOWED=NO', 'build'],
      cwd: join(example, 'ios'),
      env,
    },
  ];
}

const defaultRunner: BuildRunner = (step) =>
  new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { cwd: step.cwd, env: { ...process.env, ...step.env } });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => void (out += chunk.toString()));
    child.on('error', (error) => resolve({ code: 127, out: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });

export async function runBuildCheck(input: { repoRoot: string; reportDir: string; javaHome: string; run?: BuildRunner }): Promise<BuildReport> {
  const run = input.run ?? defaultRunner;
  const timed = async (steps: BuildStep[]): Promise<PlatformResult> => {
    const started = Date.now();
    let tail = '';
    for (const step of steps) {
      const result = await run(step);
      tail = result.out.slice(-TAIL);
      if (result.code !== 0) return { ok: false, seconds: Math.round((Date.now() - started) / 1000), tail };
    }
    return { ok: true, seconds: Math.round((Date.now() - started) / 1000), tail };
  };
  const steps = buildSteps(input.repoRoot, { javaHome: input.javaHome });
  const android = await timed(steps.slice(0, 2));
  const ios = await timed(steps.slice(2));
  const report: BuildReport = { source: sourceHash(input.repoRoot), at: new Date().toISOString(), android, ios };
  mkdirSync(input.reportDir, { recursive: true });
  writeFileSync(join(input.reportDir, REPORT_FILE), JSON.stringify(report, null, 2) + '\n');
  return report;
}

export function readBuildReport(reportDir: string): BuildReport | null {
  try {
    const parsed = JSON.parse(readFileSync(join(reportDir, REPORT_FILE), 'utf8')) as BuildReport;
    return typeof parsed.source === 'string' && typeof parsed.android?.ok === 'boolean' && typeof parsed.ios?.ok === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const javaHome = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@21';
  runBuildCheck({ repoRoot, reportDir: defaultReportDir(), javaHome }).then((report) => {
    console.log(JSON.stringify({ check: 'derleme', pass: report.android.ok && report.ios.ok, measured: `android ${report.android.ok ? 'tamam' : 'hata'} (${report.android.seconds} sn), ios ${report.ios.ok ? 'tamam' : 'hata'} (${report.ios.seconds} sn)` }));
    process.exit(report.android.ok && report.ios.ok ? 0 : 1);
  });
}
