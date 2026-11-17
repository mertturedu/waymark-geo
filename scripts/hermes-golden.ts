import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type HermesGolden = {
  error: string | null;
  total: number;
  failed: number;
  failures: { id: string; text: string; wrong: string[] }[];
  unicode: { checked: number; differences: string[] } | null;
};

const root = fileURLToPath(new URL('..', import.meta.url));

export function runHermesGolden(): HermesGolden {
  const failure = (error: string): HermesGolden => ({ error, total: 0, failed: 0, failures: [], unicode: null });
  const dir = mkdtempSync(join(tmpdir(), 'geo-hermes-golden-'));
  const bundle = join(dir, 'golden.js');
  const built = spawnSync(join(root, 'node_modules', '.bin', 'esbuild'), [join(root, 'scripts', 'hermes-entry.ts'), '--bundle', '--format=iife', '--platform=neutral', '--target=es2019', `--outfile=${bundle}`], { encoding: 'utf8', cwd: root });
  if (built.status !== 0) return failure(`bundle failed: ${built.stderr.slice(-300)}`);
  const run = spawnSync(join(root, 'pipeline', 'bin', 'hermes', 'hermes'), [bundle], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) return failure(`hermes failed: ${(run.stderr || run.stdout).slice(-300)}`);
  try {
    const parsed = JSON.parse(run.stdout.trim().split('\n').pop() as string) as Omit<HermesGolden, 'error'>;
    return { error: null, ...parsed };
  } catch {
    return failure(`unreadable hermes output: ${run.stdout.slice(-300)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runHermesGolden();
  const pass = result.error === null && result.failed === 0 && (result.unicode?.differences.length ?? 1) === 0;
  console.log(JSON.stringify({ check: 'hermes', pass, measured: result.error ?? `${result.total - result.failed}/${result.total}, unicode ${result.unicode?.checked ?? 0} kontrol, ${result.unicode?.differences.length ?? 0} fark` }));
  process.exit(pass ? 0 : 1);
}
