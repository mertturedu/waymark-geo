import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLE, PHONE, runJob } from './device-run';

export type Mark = { id: string; at: number };

export const newMarks = (marks: Mark[], seen: number): Mark[] => marks.slice(seen);

export const shotPath = (dir: string, mark: Mark): string => join(dir, `${mark.id.replace(/[^A-Za-z0-9._-]/g, '_')}.png`);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const value = (flag: string): string | undefined => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : undefined);
  const out = value('--out');
  const server = value('--server') ?? 'http://127.0.0.1:8090';
  const udid = value('--udid') ?? PHONE;
  const expected = Number(value('--count') ?? 5);
  const timeoutMs = Number(value('--timeout') ?? 300) * 1000;
  if (!out) {
    console.error('usage: npx tsx scripts/device-shots.ts --out <klasör> [--count 5] [--server url] [--udid id] [--timeout s]');
    return 2;
  }
  mkdirSync(out, { recursive: true });
  const before = ((await (await fetch(`${server}/marks`)).json()) as Mark[]).length;
  execFileSync('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', udid, '--terminate-existing', BUNDLE], { stdio: 'pipe' });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const response = await fetch(`${server}/run`, { method: 'POST', body: runJob(['sdk.shot-tour'], false, String(Date.now()), 1, 'phone') });
  if (!response.ok) throw new Error(`iş bırakılamadı: ${response.status}`);
  const deadline = Date.now() + timeoutMs;
  let seen = before;
  let taken = 0;
  while (taken < expected && Date.now() < deadline) {
    const marks = (await (await fetch(`${server}/marks`)).json()) as Mark[];
    for (const mark of newMarks(marks, seen)) {
      execFileSync('xcrun', ['devicectl', 'device', 'capture', 'screenshot', '--device', udid, '--destination', shotPath(out, mark)], { stdio: 'pipe' });
      console.log(`görüntü: ${shotPath(out, mark)}`);
      taken += 1;
    }
    seen = marks.length;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return taken === expected ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
