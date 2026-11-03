import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DeviceReport } from '../src/core/report/types';
import { defaultReportDir } from './device-report';

export const BUNDLE = 'com.aakgur.yuksigeoexample';
export const PHONE = '00008030-001A59511E23402E';
export const SCHEME = 'geoornek';
export const LAUNCH_WAIT_MS = 4000;

export type Target = 'sim' | 'phone';
export type RunArgs = { target: Target; ids: string[] | 'auto'; tab: boolean; timeoutMs: number; udid: string; location: [number, number] | null; fresh: boolean; rss: boolean; server: string; repeat: number };

export function parseArgs(argv: string[]): RunArgs | string {
  const value = (flag: string): string | undefined => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : undefined;
  };
  const target = value('--target') ?? 'sim';
  if (target !== 'sim' && target !== 'phone') return `unknown target: ${target}`;
  const rawIds = value('--ids');
  if (!rawIds) return 'missing --ids';
  const ids = rawIds === 'auto' ? 'auto' : rawIds.split(',').map((id) => id.trim()).filter((id) => id !== '');
  if (ids !== 'auto' && ids.length === 0) return 'missing --ids';
  const timeout = Number(value('--timeout') ?? 900);
  if (!Number.isFinite(timeout) || timeout <= 0) return 'bad --timeout';
  const repeat = Number(value('--repeat') ?? 1);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) return 'bad --repeat (1-20)';
  const at = value('--location');
  let location: [number, number] | null = null;
  if (at !== undefined) {
    const parts = at.split(',').map(Number);
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part)) || Math.abs(parts[0]!) > 90 || Math.abs(parts[1]!) > 180) return 'bad --location (lat,lon)';
    location = [parts[0]!, parts[1]!];
  }
  return { target, ids, tab: argv.includes('--app'), timeoutMs: timeout * 1000, udid: value('--udid') ?? PHONE, location, fresh: argv.includes('--fresh'), rss: argv.includes('--rss'), server: value('--server') ?? `http://127.0.0.1:${process.env.PORT ?? 8090}`, repeat };
}

export function runUrl(ids: string[] | 'auto', tab: boolean, nonce: string): string {
  const list = ids === 'auto' ? 'auto' : ids.map(encodeURIComponent).join(',');
  return `${SCHEME}://run?ids=${list}${tab ? '&tab=app' : ''}&n=${encodeURIComponent(nonce)}`;
}

export const runJob = (ids: string[] | 'auto', tab: boolean, nonce: string, repeat = 1, target?: Target): string => JSON.stringify({ ids, ...(tab ? { tab: 'app' } : {}), ...(repeat > 1 ? { repeat } : {}), ...(target ? { target } : {}), n: nonce });

export function launchCommands(args: RunArgs): { argv: string[]; optional: boolean }[] {
  if (args.target === 'phone') return [{ argv: ['xcrun', 'devicectl', 'device', 'process', 'launch', '--device', args.udid, '--terminate-existing', BUNDLE], optional: false }];
  const out: { argv: string[]; optional: boolean }[] = [];
  if (args.fresh) out.push({ argv: ['xcrun', 'simctl', 'terminate', 'booted', BUNDLE], optional: true });
  if (args.location) {
    out.push({ argv: ['xcrun', 'simctl', 'privacy', 'booted', 'grant', 'location', BUNDLE], optional: false });
    out.push({ argv: ['xcrun', 'simctl', 'location', 'booted', 'set', `${args.location[0]},${args.location[1]}`], optional: false });
  }
  out.push({ argv: ['xcrun', 'simctl', 'launch', 'booted', BUNDLE], optional: false });
  return out;
}

export type WaitDeps = { list(dir: string): string[]; mtime(path: string): number; sleep(ms: number): Promise<void>; now(): number };

export const realDeps: WaitDeps = {
  list: (dir) => (existsSync(dir) ? readdirSync(dir) : []),
  mtime: (path) => statSync(path).mtimeMs,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export async function waitForReport(dir: string, since: number, timeoutMs: number, deps: WaitDeps = realDeps, pollMs = 1000, onPoll?: () => void): Promise<string | null> {
  const deadline = deps.now() + timeoutMs;
  for (;;) {
    onPoll?.();
    const fresh = deps
      .list(dir)
      .filter((name) => name.startsWith('cihaz-') && name.endsWith('.json'))
      .map((name) => join(dir, name))
      .filter((path) => deps.mtime(path) >= since)
      .sort((a, b) => deps.mtime(b) - deps.mtime(a));
    if (fresh[0]) return fresh[0];
    if (deps.now() >= deadline) return null;
    await deps.sleep(pollMs);
  }
}

export const SIM_PROCESS = 'GeoOrnek.app/GeoOrnek';

export function parseRss(pgrep: string, ps: (pid: string) => string): number | null {
  const pids = pgrep.split(/\s+/).filter((pid) => /^\d+$/.test(pid));
  let best: number | null = null;
  for (const pid of pids) {
    const kb = Number(ps(pid).trim());
    if (Number.isFinite(kb) && kb > 0) best = Math.max(best ?? 0, kb);
  }
  return best;
}

const simRss = (): number | null => {
  try {
    const pgrep = execFileSync('pgrep', ['-f', SIM_PROCESS], { encoding: 'utf8' });
    return parseRss(pgrep, (pid) => execFileSync('ps', ['-o', 'rss=', '-p', pid], { encoding: 'utf8' }));
  } catch {
    return null;
  }
};

export function summarize(report: DeviceReport): { failed: number; text: string } {
  const count = (outcome: string) => report.entries.filter((entry) => entry.outcome === outcome).length;
  const rows = report.entries.map((entry) => `${entry.outcome.padEnd(4)}  ${entry.id}${entry.value !== undefined ? `  ${entry.value}${entry.unit ? ` ${entry.unit}` : ''}` : ''}${entry.note ? `  (${entry.note})` : ''}`);
  const head = `${report.reportId}: ${count('pass')} geçti, ${count('fail')} hata, ${count('info')} bilgi, ${count('skip')} atlandı`;
  return { failed: count('fail'), text: [head, ...rows].join('\n') };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(`${args}\nusage: npx tsx scripts/device-run.ts --target sim|phone --ids <id,id|auto> [--app] [--location lat,lon] [--timeout s] [--fresh] [--rss] [--udid id] [--server url] [--repeat n]`);
    return 2;
  }
  const dir = join(defaultReportDir(), 'cihaz');
  const since = Date.now();
  for (const command of launchCommands(args)) {
    try {
      execFileSync(command.argv[0]!, command.argv.slice(1), { stdio: 'pipe' });
    } catch (error) {
      if (command.optional) continue;
      console.error(`failed: ${command.argv.join(' ')}\n${error instanceof Error ? error.message : String(error)}`);
      if (args.target === 'phone') console.error('telefon kilitli ya da bağlı değil olabilir');
      return 1;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, LAUNCH_WAIT_MS));
  const job = runJob(args.ids, args.tab, String(since), args.repeat, args.target);
  try {
    const response = await fetch(`${args.server.replace(/\/+$/, '')}/run`, { method: 'POST', body: job });
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  } catch (error) {
    console.error(`paket sunucusuna iş bırakılamadı (${args.server}): ${error instanceof Error ? error.message : String(error)}\nnpm run serve:packs -- dist/packs açık mı?`);
    return 1;
  }
  console.log(`started: ${job}`);
  let peakKb = 0;
  const sample = args.rss && args.target === 'sim' ? () => void (peakKb = Math.max(peakKb, simRss() ?? 0)) : undefined;
  const path = await waitForReport(dir, since, args.timeoutMs, realDeps, 1000, sample);
  if (sample) console.log(`simülatör uygulama belleği en yüksek: ${peakKb > 0 ? `${Math.round(peakKb / 1024)} MB` : 'okunamadı'}`);
  if (!path) {
    console.error(`no report within ${args.timeoutMs / 1000} s (paket sunucusu açık mı: npm run serve:packs -- dist/packs)`);
    return 1;
  }
  const summary = summarize(JSON.parse(readFileSync(path, 'utf8')) as DeviceReport);
  console.log(summary.text);
  console.log(path.replace(/\.json$/, '.md'));
  return summary.failed > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
