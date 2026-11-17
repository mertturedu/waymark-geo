import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadOfficial, loadSeeds, writeNationalRows } from '../pipeline/build/admin-national-step';
import { repoRoot } from './addr-sets';

export const workDir = (): string => join(repoRoot, 'dist', 'work', '261028');

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
  const dir = workDir();
  const official = loadOfficial(repoRoot);
  const seeds = loadSeeds(dir);
  const plates = arg ? arg.split(',') : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  for (const plate of plates) {
    const started = Date.now();
    const r = await writeNationalRows({ workDir: dir, plate, official, seeds });
    mkdirSync(join(dir, 'admin-national-stats'), { recursive: true });
    writeFileSync(join(dir, 'admin-national-stats', `${plate}.json`), JSON.stringify(r.stats));
    console.log(plate, JSON.stringify(r.stats), `${Date.now() - started} ms`);
  }
}

if (process.argv[1]?.endsWith('admin-national-build.ts')) void main();
