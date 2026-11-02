import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultReportDir } from '../scripts/device-report';
import { exitCodeFor, renderGateTable, runGates, type Gate, type GateContext } from './engine';
import { phase0Gates } from './phase-0';
import { phase1Gates } from './phase-1';
import { phase2Gates } from './phase-2';
import { phase3Gates } from './phase-3';
import { phase4Gates } from './phase-4';
import { phase5Gates } from './phase-5';
import { phase6Gates } from './phase-6';
import { phase7Gates } from './phase-7';
import { phase8Gates } from './phase-8';

const PHASES: Record<number, Gate[]> = { 0: phase0Gates, 1: phase1Gates, 2: phase2Gates, 3: phase3Gates, 4: phase4Gates, 5: phase5Gates, 6: phase6Gates, 7: phase7Gates, 8: phase8Gates };

export function parsePhaseArg(argv: string[]): number | null {
  const at = argv.indexOf('--phase');
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

const nodeRun = (cwd: string): GateContext['run'] => (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', (error) => resolve({ code: 127, out: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });

async function main(): Promise<number> {
  const phase = parsePhaseArg(process.argv.slice(2));
  const gates = phase === null ? undefined : PHASES[phase];
  if (phase === null || !gates) {
    console.error(`no gates for phase ${phase === null ? '(missing --phase N)' : phase}`);
    return 2;
  }
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const reportDir = defaultReportDir();
  const results = await runGates(
    Object.values(PHASES).flatMap((list) => list.filter((g) => g.phase <= phase)),
    { reportDir, repoRoot, run: nodeRun(repoRoot) },
  );
  const table = renderGateTable(results);
  console.log(table);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `faz-${phase}-kapilar.md`), `# Faz ${phase} kapıları\n\n${table}`);
  return exitCodeFor(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
