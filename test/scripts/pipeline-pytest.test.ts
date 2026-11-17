import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

describe('pipeline python tests', () => {
  it('pass', () => {
    const root = process.cwd();
    const run = spawnSync(join(root, 'pipeline', '.venv', 'bin', 'python'), ['-m', 'pytest', 'pipeline/tests', '-q', '-p', 'no:cacheprovider'], { encoding: 'utf8', cwd: root });
    expect(run.stdout + run.stderr).toMatch(/passed/);
    expect(run.status).toBe(0);
  });
});
