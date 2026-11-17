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
import { adres0Gates } from './adres-0';
import { adres1Gates } from './adres-1';
import { adres2Gates } from './adres-2';
import { adres3Gates } from './adres-3';
import { adres4Gates } from './adres-4';
import { adres5Gates } from './adres-5';
import { adres6Gates } from './adres-6';
import { adres7Gates } from './adres-7';
import { adres8Gates } from './adres-8';
import { adres9Gates } from './adres-9';
import { adres10Gates } from './adres-10';
import { adres11Gates } from './adres-11';
import { adres12Gates } from './adres-12';
import { adres13Gates } from './adres-13';
import { adres14Gates } from './adres-14';
import { adres15Gates } from './adres-15';
import { adres16Gates } from './adres-16';
import { adres16aGates } from './adres-16a';
import { adres16bGates } from './adres-16b';
import { adres16cGates } from './adres-16c';
import { adres16dGates } from './adres-16d';
import { adres16eGates } from './adres-16e';
import { adres16fGates } from './adres-16f';
import { adres16gGates } from './adres-16g';
import { adres17Gates } from './adres-17';
import { adres18Gates } from './adres-18';

export const FIX_PHASES: Record<number, Gate[]> = { 0: fix0Gates, 1: fix1Gates, 2: fix2Gates, 3: fix3Gates, 4: fix4Gates, 5: fix5Gates, 6: fix6Gates, 7: fix7Gates, 8: fix8Gates, 9: fix9Gates };

export const ADRES_PHASES: Record<number, Gate[]> = { 0: adres0Gates, 1: adres1Gates, 2: adres2Gates, 3: adres3Gates, 4: adres4Gates, 5: adres5Gates, 6: adres6Gates, 7: adres7Gates, 8: adres8Gates, 9: adres9Gates, 10: adres10Gates, 11: adres11Gates, 12: adres12Gates, 13: adres13Gates, 14: adres14Gates, 15: adres15Gates, 16: adres16Gates, 16.5: adres16aGates, 16.6: adres16bGates, 16.7: adres16cGates, 16.8: adres16dGates, 16.9: adres16eGates, 16.91: adres16fGates, 16.92: adres16gGates, 17: adres17Gates, 18: adres18Gates };

const PHASES: Record<number, Gate[]> = { 0: phase0Gates, 1: phase1Gates, 2: phase2Gates, 3: phase3Gates, 4: phase4Gates, 5: phase5Gates, 6: phase6Gates, 7: phase7Gates, 8: phase8Gates };

export function parseFixArg(argv: string[]): number | null {
  const at = argv.indexOf('--fix');
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

const ADRES_LETTERS: Record<string, number> = { a: 0.5, b: 0.6, c: 0.7, d: 0.8, e: 0.9, f: 0.91, g: 0.92 };

export function parseAdresArg(argv: string[]): number | null {
  const at = argv.indexOf('--adres');
  const value = at >= 0 ? argv[at + 1] : undefined;
  const lettered = value === undefined ? null : /^(\d+)([a-gA-G])$/.exec(value);
  if (lettered) return Number(lettered[1]) + (ADRES_LETTERS[(lettered[2] as string).toLowerCase()] as number);
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

async function runAdres(phase: number): Promise<number> {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  const reportDir = defaultReportDir();
  const letter = Object.entries(ADRES_LETTERS).find(([, f]) => Math.abs(phase - Math.floor(phase) - f) < 0.001)?.[0] ?? '';
  const label = Number.isInteger(phase) ? String(phase) : `${Math.floor(phase)}${letter}`;
  const only = process.argv.includes('--only');
  const gates = Object.entries(ADRES_PHASES).filter(([n]) => (only ? Number(n) === phase : Number(n) <= phase)).flatMap(([, list]) => list);
  if (gates.length === 0) {
    console.error(`no gates for adres ${label}`);
    return 2;
  }
  const results = await runGates(gates, { reportDir, repoRoot, run: nodeRun(repoRoot) });
  const table = renderGateTable(results);
  console.log(table);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, `adres-faz-${label}-kapilar.md`), `# Adres Faz ${label} kapıları\n\n${table}`);
  return exitCodeFor(results);
}

async function main(): Promise<number> {
  const fix = parseFixArg(process.argv.slice(2));
  if (fix !== null) return runFix(fix);
  const adres = parseAdresArg(process.argv.slice(2));
  if (adres !== null) return runAdres(adres);
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
