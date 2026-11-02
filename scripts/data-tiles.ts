import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PRIORITY_PLATES, buildBasePack, buildProvinceTiles } from '../pipeline/build/tiles';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as { osmFile: string; tilesBuild: string };
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const budgets = Object.fromEntries((JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'section3-door-counts.json'), 'utf8')) as { plate: string; tileMB: number }[]).map((r) => [r.plate, r.tileMB]));
  const regionsDir = join(work, 'regions');
  const outDir = join(work, `tiles-${sources.tilesBuild}`);
  const wanted = arg('--plates') ?? '12il';
  const all = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const plates = wanted === '12il' ? PRIORITY_PLATES : wanted === 'all' ? [...PRIORITY_PLATES, ...all.filter((p) => !PRIORITY_PLATES.includes(p))] : wanted.split(',');
  const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (process.argv.includes('--base')) log(`temel paket ${(await buildBasePack({ build: sources.tilesBuild, outDir: join(work, `base-${sources.tilesBuild}`) })).length} dosya`);
  await buildProvinceTiles({ regionsDir, outDir, build: sources.tilesBuild, plates, budgets, log });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
