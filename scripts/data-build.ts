import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ADDRESS_STEPS, resolvePlates, runBuild } from '../pipeline/build/orchestrate';
import { defaultRunner } from '../pipeline/build/tiles';
import type { Sources } from './fetch-sources';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function optionValue(argv: string[], name: string): string | undefined {
  const joined = argv.find((a) => a.startsWith(`${name}=`));
  if (joined) return joined.slice(name.length + 1);
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as Sources;
  const plates = resolvePlates(optionValue(argv, '--regions') ?? '12il');
  const workDir = join(repoRoot, 'dist', 'work', optionValue(argv, '--work') ?? sources.osmFile.slice(7, 13));
  const log = (line: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);
  log(`${plates.length} il: ${plates.join(',')}`);
  const result = await runBuild({
    plates,
    sources,
    workDir,
    outDir: optionValue(argv, '--out') ?? join(repoRoot, 'dist', 'packs'),
    pbf: join(repoRoot, 'pipeline', 'data', sources.osmFile),
    python: join(repoRoot, 'pipeline', '.venv', 'bin', 'python'),
    run: defaultRunner,
    repoRoot,
    force: argv.includes('--force'),
    ...(optionValue(argv, '--steps') === 'adres' ? { only: ADDRESS_STEPS } : optionValue(argv, '--steps') === 'rehber' ? { only: ['rehber paketleri'] } : {}),
    log,
  });
  if (!result.ok) {
    console.error(`${result.failed?.name} adımı kırıldı: ${result.failed?.message}`);
    return 1;
  }
  log(`bitti: ${result.steps.map((s) => `${s.name} ${s.skipped ? 'atlandı' : (s.ms / 1000).toFixed(1) + ' sn'}`).join(', ')}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
