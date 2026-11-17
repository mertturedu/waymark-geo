import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAddressPack } from '../pipeline/build/address-pack';
import { PRIORITY_PLATES } from '../pipeline/build/tiles';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as { osmFile: string; osmTimestamp: string };
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const wanted = arg('--plates') ?? '12il';
  const all = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const plates = wanted === '12il' ? PRIORITY_PLATES : wanted === 'all' ? all : wanted.split(',');
  let total = 0;
  for (const plate of plates) {
    mkdirSync(join(work, 'packs', plate), { recursive: true });
    const started = Date.now();
    const stats = await buildAddressPack({ province: plate, workDir: work, outFile: join(work, 'packs', plate, 'address.sqlite'), osmTimestamp: sources.osmTimestamp });
    total += stats.bytes;
    console.log(`${plate} ${(stats.bytes / 1e6).toFixed(2)} MB rows ${stats.rows} streets ${stats.streets} parts ${stats.parts} places ${stats.places} hoods ${stats.neighbourhoods} search ${stats.searchNames} ${Date.now() - started} ms`);
    if (process.argv.includes('--tables')) console.log(JSON.stringify(stats.tables));
  }
  console.log(`toplam ${(total / 1e6).toFixed(2)} MB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
