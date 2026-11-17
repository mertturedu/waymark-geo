import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';

const root = fileURLToPath(new URL('..', import.meta.url));

export type HermesBuildings = { error: string | null; total: number; different: number; p50: number; p95: number; max: number };

export function runHermesBuildings(): HermesBuildings {
  const failure = (error: string): HermesBuildings => ({ error, total: 0, different: 0, p50: 0, p95: 0, max: 0 });
  const dir = mkdtempSync(join(tmpdir(), 'geo-hermes-buildings-'));
  const bundle = join(dir, 'buildings.js');
  const built = spawnSync(join(root, 'node_modules', '.bin', 'esbuild'), [join(root, 'scripts', 'hermes-buildings-entry.ts'), '--bundle', '--format=iife', '--platform=neutral', '--target=es2016', `--outfile=${bundle}`], { encoding: 'utf8', cwd: root });
  if (built.status !== 0) return failure(`bundle failed: ${built.stderr.slice(-300)}`);
  const run = spawnSync(join(root, 'pipeline', 'bin', 'hermes', 'hermes'), [bundle], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) return failure(`hermes failed: ${(run.stderr || run.stdout).slice(-300)}`);
  try {
    return { error: null, ...(JSON.parse(run.stdout.trim().split('\n').pop() as string) as Omit<HermesBuildings, 'error'>) };
  } catch {
    return failure(`unreadable hermes output: ${run.stdout.slice(-300)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runHermesBuildings();
  console.log(JSON.stringify(result));
  if (result.error === null) recordMeasure('a5_hermes', result);
  process.exit(result.error === null && result.different === 0 && result.p95 <= 5 ? 0 : 1);
}
