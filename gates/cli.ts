import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultReportDir } from '../scripts/device-report';
import { exitCodeFor, renderGateTable, runGates, type Gate, type GateContext, type GateResult } from './engine';
import { phase0Gates } from './phase-0';
import { phase1Gates } from './phase-1';
import { phase2Gates } from './phase-2';
import { phase3Gates } from './phase-3';
import { phase4Gates } from './phase-4';
import { phase5Gates } from './phase-5';
import { phase6Gates } from './phase-6';
import { phase7Gates } from './phase-7';
import { phase8Gates } from './phase-8';
import { fix0Gates } from './fix-0';
import { fix1Gates } from './fix-1';
import { fix2Gates } from './fix-2';
import { fix3Gates } from './fix-3';
import { fix4Gates } from './fix-4';
import { fix5Gates } from './fix-5';
import { fix6Gates } from './fix-6';
import { fix7Gates } from './fix-7';
import { fix8Gates } from './fix-8';
import { fix9Gates } from './fix-9';

export const FIX_PHASES: Record<number, Gate[]> = { 0: fix0Gates, 1: fix1Gates, 2: fix2Gates, 3: fix3Gates, 4: fix4Gates, 5: fix5Gates, 6: fix6Gates, 7: fix7Gates, 8: fix8Gates, 9: fix9Gates };

const PHASES: Record<number, Gate[]> = { 0: phase0Gates, 1: phase1Gates, 2: phase2Gates, 3: phase3Gates, 4: phase4Gates, 5: phase5Gates, 6: phase6Gates, 7: phase7Gates, 8: phase8Gates };

export function parseFixArg(argv: string[]): number | null {
  const at = argv.indexOf('--fix');
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

export function parsePhaseArg(argv: string[]): number | null {
  const at = argv.indexOf('--phase');
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

export const MUTATION_SKIPPED = 'MUTATION_SKIPPED';

export const isMutationRun = (cmd: string, args: string[]): boolean => (cmd === 'npm' && args[0] === 'run' && args[1] === 'mutation') || (cmd === 'npx' && args[0] === 'stryker');

export function markSkipped(results: GateResult[]): GateResult[] {
  return results.map((result) => (result.measured.includes(MUTATION_SKIPPED) ? { ...result, status: 'open', measured: 'mutasyon atlandı (GEO_SKIP_MUTATION=1); tam koşu ayrıca' } : result));
}

const nodeRun = (cwd: string, skipMutation = process.env.GEO_SKIP_MUTATION === '1'): GateContext['run'] => (cmd, args) =>
  skipMutation && isMutationRun(cmd, args) ? Promise.resolve({ code: 99, out: MUTATION_SKIPPED }) : new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = '';
    child.stdout.on('data', (chunk) => (out += String(chunk)));
    child.stderr.on('data', (chunk) => (out += String(chunk)));
    child.on('error', (error) => resolve({ code: 127, out: String(error) }));
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });

async function runFix(fix: number): Promise<number> {
  const gates = FIX_PHASES[fix];
  if (!gates) {
    console.error(`no gates for fix ${fix}`);
    return 2;
  }
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const reportDir = defaultReportDir();
  const results = await runGates(gates, { reportDir, repoRoot, run: nodeRun(repoRoot) });
  const table = renderGateTable(results);
  console.log(table);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `fix-${fix}-kapilar.md`), `# F${fix} kapıları\n\n${table}`);
  return exitCodeFor(results);
}

async function main(): Promise<number> {
  const fix = parseFixArg(process.argv.slice(2));
  if (fix !== null) return runFix(fix);
  const phase = parsePhaseArg(process.argv.slice(2));
  const gates = phase === null ? undefined : PHASES[phase];
  if (phase === null || !gates) {
    console.error(`no gates for phase ${phase === null ? '(missing --phase N)' : phase}`);
    return 2;
  }
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const reportDir = defaultReportDir();
  const results = markSkipped(await runGates(
    Object.values(PHASES).flatMap((list) => list.filter((g) => g.phase <= phase)),
    { reportDir, repoRoot, run: nodeRun(repoRoot) },
  ));
  const table = renderGateTable(results);
  console.log(table);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `faz-${phase}-kapilar.md`), `# Faz ${phase} kapıları\n\n${table}`);
  return exitCodeFor(results);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
