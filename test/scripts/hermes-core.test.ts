import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeParity } from '../helpers/core-parity';

const root = process.cwd();

describe('Hermes and Node read the number and geometry code alike', () => {
  it('gives the same answers for every case', () => {
    const dir = mkdtempSync(join(tmpdir(), 'geo-hermes-core-'));
    const bundle = join(dir, 'core.js');
    const built = spawnSync(join(root, 'node_modules', '.bin', 'esbuild'), [join(root, 'scripts', 'hermes-core-entry.ts'), '--bundle', '--format=iife', '--platform=neutral', '--target=es2019', `--outfile=${bundle}`], { encoding: 'utf8', cwd: root });
    expect(built.status).toBe(0);
    const run = spawnSync(join(root, 'pipeline', 'bin', 'hermes', 'hermes'), [bundle], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    const fromHermes = JSON.parse(run.stdout.trim().split('\n').pop() as string);
    expect(fromHermes).toEqual(JSON.parse(JSON.stringify(computeParity())));
  }, 120_000);
});
