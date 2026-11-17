import { createHash } from 'node:crypto';
import { createReadStream, readdirSync } from 'node:fs';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync as list, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePacks, type RegionInput } from '../pipeline/build/manifest';
import { buildSteps, encodeInput, pruneEnabled, pruneInput, resolvePlates, runSteps, tileFiles, type Step } from '../pipeline/build/orchestrate';
import { encodeAll, tileFormat } from '../pipeline/build/tile-encode';
import { pruneBuild } from '../pipeline/build/tile-prune';
import { PRIORITY_PLATES, buildBasePack, buildProvinceTiles, defaultRunner } from '../pipeline/build/tiles';
import { createBorders } from '../src/core/region/borders';
import adminData from '../src/core/text/data/admin.json';
import type { Sources } from './fetch-sources';

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    return entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')];
  });
}

export type TreeComparison = { compared: number; equal: number; differing: string[]; onlyA: string[]; onlyB: string[] };

export async function compareTrees(a: string, b: string, include: (path: string) => boolean = () => true): Promise<TreeComparison> {
  const left = new Set(listFiles(a).filter(include));
  const right = new Set(listFiles(b).filter(include));
  const result: TreeComparison = { compared: 0, equal: 0, differing: [], onlyA: [], onlyB: [] };
  for (const path of [...left].sort()) {
    if (!right.has(path)) {
      result.onlyA.push(path);
      continue;
    }
    result.compared += 1;
    if ((await hashFile(join(a, path))) === (await hashFile(join(b, path)))) result.equal += 1;
    else result.differing.push(path);
  }
  for (const path of [...right].sort()) if (!left.has(path)) result.onlyB.push(path);
  return result;
}

export function isComparable(path: string, build: string, priority: string[]): boolean {
  if (path === 'validation.json' || path === 'borders.bin' || path.startsWith('clips/')) return false;
  const tiles = [`tiles-${build}/`, `tiles-${build}-pruned/`, `tiles-${build}-mlt/`, `tiles-${build}-pruned-mlt/`].find((dir) => path.startsWith(dir));
  return !tiles || priority.includes(path.slice(tiles.length, tiles.length + 2));
}

export type DeterminismResult = TreeComparison & { bordersEqual: boolean; manifestsEqual: boolean; tilesCompared: number };

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const LEFT_OUT = ['karolar', 'karo budama', 'karo kodlama', 'doğrulama ve yayın'];

export const stepsToRepeat = (steps: Step[]): Step[] => steps.filter((s) => !LEFT_OUT.includes(s.name));

export async function runDeterminism(sources: Sources, log: (line: string) => void = () => undefined): Promise<DeterminismResult> {
  const first = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const second = `${first}-second`;
  mkdirSync(second, { recursive: true });
  for (const entry of existsSync(second) ? list(second) : []) if (!entry.startsWith('tiles-') && !entry.startsWith('base-')) rmSync(join(second, entry), { recursive: true, force: true });
  const plates = resolvePlates('all');
  const bordersOut = join(second, 'borders.bin');
  const steps = buildSteps({ plates, sources, workDir: second, outDir: join(second, 'unused'), pbf: join(repoRoot, 'pipeline', 'data', sources.osmFile), python: join(repoRoot, 'pipeline', '.venv', 'bin', 'python'), run: defaultRunner, repoRoot, bordersOut, log });
  const built = await runSteps(stepsToRepeat(steps), { markers: join(second, '.markers'), force: true, log });
  if (!built.ok) throw new Error(`ikinci kurulum kırıldı: ${built.failed?.name}: ${built.failed?.message}`);
  const budgets: Record<string, number> = {};
  await buildBasePack({ build: sources.tilesBuild, outDir: join(second, `base-${sources.tilesBuild}`) });
  await buildProvinceTiles({ regionsDir: join(second, 'regions'), outDir: join(second, `tiles-${sources.tilesBuild}`), build: sources.tilesBuild, plates: [...PRIORITY_PLATES].sort(), budgets, log });
  if (pruneEnabled()) {
    for (const plate of plates.filter((p) => !PRIORITY_PLATES.includes(p))) {
      const from = tileFiles(first, sources.tilesBuild, false).tiles(plate);
      const to = tileFiles(second, sources.tilesBuild, false).tiles(plate);
      if (existsSync(from) && !existsSync(to)) linkSync(from, to);
    }
    pruneBuild(pruneInput(second, sources.tilesBuild, plates, log));
  }
  if (tileFormat() === 'mlt') await encodeAll(encodeInput(second, sources.tilesBuild, plates, log));

  const tileDir = `tiles-${sources.tilesBuild}/`;
  const tree = await compareTrees(first, second, (path) => isComparable(path, sources.tilesBuild, PRIORITY_PLATES));

  const bordersEqual = (await hashFile(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))) === (await hashFile(bordersOut));
  const names = new Map(adminData.provinces.map((p) => [p.plate, p.names as Record<string, string>]));
  const borders = createBorders(readFileSync(bordersOut));
  const regionsFor = (work: string): RegionInput[] =>
    [...PRIORITY_PLATES].sort().map((plate) => {
      const stats = JSON.parse(readFileSync(join(work, 'packs', plate, 'stats.json'), 'utf8')) as { rows: number; streets: number; neighbourhoods: number };
      return {
        id: plate,
        tier: 'full' as const,
        names: names.get(plate) ?? { tr: plate },
        bbox: borders.provinceBounds(plate) as [number, number, number, number],
        stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods },
        files: [
          { kind: 'address' as const, source: join(work, 'packs', plate, 'address.sqlite') },
          ...(existsSync(join(work, 'packs', plate, 'buildings.sqlite')) ? [{ kind: 'buildings' as const, source: join(work, 'packs', plate, 'buildings.sqlite') }] : []),
          { kind: 'tiles' as const, source: tileFiles(work, sources.tilesBuild).tiles(plate) },
          ...(existsSync(tileFiles(work, sources.tilesBuild).places(plate)) ? [{ kind: 'places' as const, source: tileFiles(work, sources.tilesBuild).places(plate) }] : []),
          ...(existsSync(join(work, 'packs', plate, 'directory.sqlite')) ? [{ kind: 'directory' as const, source: join(work, 'packs', plate, 'directory.sqlite') }] : []),
          ...(existsSync(join(work, 'packs', plate, 'route.bin')) ? [{ kind: 'route' as const, source: join(work, 'packs', plate, 'route.bin') }] : []),
        ],
      };
    });
  const keyDir = join(second, '.keys');
  const stageA = join(second, '.stage-a');
  const stageB = join(second, '.stage-b');
  rmSync(stageA, { recursive: true, force: true });
  rmSync(stageB, { recursive: true, force: true });
  await assemblePacks({ outDir: stageA, sources, regions: regionsFor(first), baseDir: tileFiles(first, sources.tilesBuild).base, keyDir, minSdk: '0.3.0' });
  await assemblePacks({ outDir: stageB, sources, regions: regionsFor(second), baseDir: tileFiles(second, sources.tilesBuild).base, keyDir, minSdk: '0.3.0' });
  const manifests = await compareTrees(stageA, stageB);
  const manifestsEqual = manifests.differing.length === 0 && manifests.onlyA.length === 0 && manifests.onlyB.length === 0 && manifests.compared > 0;
  rmSync(stageA, { recursive: true, force: true });
  rmSync(stageB, { recursive: true, force: true });
  const tilesCompared = PRIORITY_PLATES.filter((plate) => existsSync(join(first, `${tileDir}${plate}.pmtiles`)) && existsSync(join(second, `${tileDir}${plate}.pmtiles`))).length;
  return { ...tree, bordersEqual, manifestsEqual, tilesCompared };
}
