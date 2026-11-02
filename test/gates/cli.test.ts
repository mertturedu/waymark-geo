import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePhaseArg } from '../../gates/cli';
import { runTry } from '../../scripts/try';

describe('parsePhaseArg', () => {
  it('reads --phase N', () => {
    expect(parsePhaseArg(['--phase', '0'])).toBe(0);
    expect(parsePhaseArg(['--phase', '12'])).toBe(12);
  });

  it.each([[[]], [['--phase']], [['--phase', 'x']], [['--phase', '-1']], [['--phase', '1.5']]])('rejects %j', (argv) => {
    expect(parsePhaseArg(argv)).toBeNull();
  });
});

describe('gates command', () => {
  it('exits 2 for a phase that has no gates', () => {
    const run = spawnSync('npx', ['tsx', 'gates/cli.ts', '--phase', '99'], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, GEO_REPORT_DIR: mkdtempSync(join(tmpdir(), 'geo-cli-')) },
    });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('phase 99');
  });
});

describe('runTry', () => {
  it('runs a registered command with its arguments', async () => {
    const seen: string[][] = [];
    const result = await runTry(['echo', 'a', 'b'], { echo: async (args) => { seen.push(args); } });
    expect(result.code).toBe(0);
    expect(seen).toEqual([['a', 'b']]);
  });

  it('exits 2 for an unknown command and lists the known ones', async () => {
    const result = await runTry(['nope'], { echo: async () => undefined });
    expect(result.code).toBe(2);
    expect(result.message).toContain('echo');
  });

  it('exits 2 without a command', async () => {
    expect((await runTry([], {})).code).toBe(2);
  });
});
