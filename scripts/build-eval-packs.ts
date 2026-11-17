import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildAddressPack } from '../pipeline/build/address-pack';
import { repoRoot } from './addr-sets';

async function main(): Promise<void> {
  const [work, name, list] = [process.argv[2], process.argv[3], process.argv[4]];
  if (!work || !name || !list) throw new Error('kullanım: build-eval-packs <çalışma-klasörü-adı> <çıktı-adı> <iller>');
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as { osmTimestamp: string };
  for (const plate of list.split(',')) {
    const dir = join(repoRoot, 'dist', 'eval-packs', name, plate);
    mkdirSync(dir, { recursive: true });
    const started = Date.now();
    const stats = await buildAddressPack({ province: plate, workDir: join(repoRoot, 'dist', 'work', work), outFile: join(dir, 'address.sqlite'), osmTimestamp: sources.osmTimestamp });
    console.log(`${plate}: ${stats.streets} sokak, ${Math.round((Date.now() - started) / 1000)} sn`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
