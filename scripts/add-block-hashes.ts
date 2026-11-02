import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocksOf, defaultKeyDir, ensureDevKey, signManifest } from '../pipeline/build/manifest';
import { parseManifest, serializeManifest } from '../src/core/region/manifest';

const dir = process.argv[2];
if (!dir) {
  console.error('kullanım: add-block-hashes <paket klasörü>');
  process.exit(1);
}
const manifest = parseManifest(readFileSync(join(dir, 'manifest-v1.json'), 'utf8'));
let changed = 0;
for (const file of [...manifest.base, ...manifest.regions.flatMap((r) => r.files)]) {
  if (file.blocks) continue;
  const blocks = blocksOf(join(dir, file.path));
  if (blocks) {
    file.blocks = blocks;
    changed += 1;
  }
}
ensureDevKey(defaultKeyDir());
const text = serializeManifest(manifest);
writeFileSync(join(dir, 'manifest-v1.json'), text);
writeFileSync(join(dir, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(defaultKeyDir(), 'dev-signing.key'), 'utf8')));
console.log(`${changed} dosyaya blok özeti eklendi, manifest yeniden imzalandı`);
