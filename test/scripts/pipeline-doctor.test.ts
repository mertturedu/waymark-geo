import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const python = join(root, 'pipeline', '.venv', 'bin', 'python');

type Check = { name: string; ok: boolean; version?: string; detail?: string };

const doctor = (...extra: string[]) => {
  const run = spawnSync(python, ['pipeline/doctor.py', ...extra], { encoding: 'utf8', cwd: root });
  return { status: run.status, checks: (JSON.parse(run.stdout) as { checks: Check[] }).checks };
};

describe('pipeline environment', () => {
  it('reports every python dependency as working', () => {
    const { status, checks } = doctor();
    expect(status).toBe(0);
    ['osmium', 'shapely', 'networkx', 'ortools'].forEach((name) => {
      const check = checks.find((c) => c.name === name);
      expect(check).toMatchObject({ ok: true });
      expect(check?.version).toBeTruthy();
    });
  });

  it('exits 1 and names a module that cannot be imported', () => {
    const { status, checks } = doctor('--require', 'no_such_module_xyz');
    expect(status).toBe(1);
    expect(checks.find((c) => c.name === 'no_such_module_xyz')).toMatchObject({ ok: false });
  });

  it('has osmium on the path used by the pipeline', () => {
    const run = spawnSync('/opt/homebrew/bin/osmium', ['--version'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('osmium version');
  });

  it('has the pinned pmtiles binary', () => {
    const run = spawnSync(join(root, 'pipeline', 'bin', 'pmtiles'), ['version'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout + run.stderr).toContain('1.31.2');
  });

  it('has the pinned hermes command line tool and it runs a script', () => {
    const hermes = join(root, 'pipeline', 'bin', 'hermes', 'hermes');
    expect(spawnSync(hermes, ['--version'], { encoding: 'utf8' }).stdout).toContain('Hermes JavaScript compiler');
    const script = join(mkdtempSync(join(tmpdir(), 'geo-hermes-')), 'six-by-seven.js');
    writeFileSync(script, 'print(6 * 7)');
    const run = spawnSync(hermes, [script], { encoding: 'utf8' });
    expect(run.stdout.trim()).toBe('42');
  });

  it('records a sha256 for every downloaded tool', () => {
    const lock = JSON.parse(readFileSync(join(root, 'pipeline', 'tools.lock.json'), 'utf8')) as Record<string, { version: string; url: string; sha256: string }>;
    expect(lock.pmtiles?.version).toBe('1.31.2');
    expect(lock.pmtiles?.url).toContain('v1.31.2');
    expect(lock.hermes?.version).toBe('0.13.0');
    expect(lock.hermes?.url).toContain('v0.13.0');
    Object.values(lock).forEach((tool) => expect(tool.sha256).toMatch(/^[0-9a-f]{64}$/));
  });
});
