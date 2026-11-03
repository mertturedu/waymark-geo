import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { blocksOf, defaultKeyDir, signManifest } from '../pipeline/build/manifest';
import { parseManifest, serializeManifest, type Manifest } from '../src/core/region/manifest';

export type Swap = { region: string; kind: 'places'; source: string };

export function swapFiles(manifest: Manifest, swaps: Swap[], read: (path: string) => { sha256: string; size: number; blocks: ReturnType<typeof blocksOf> }): { manifest: Manifest; added: { from: string; to: string }[] } {
  const added: { from: string; to: string }[] = [];
  const next: Manifest = JSON.parse(JSON.stringify(manifest)) as Manifest;
  for (const swap of swaps) {
    const region = next.regions.find((candidate) => candidate.id === swap.region);
    const file = region?.files.find((candidate) => candidate.kind === swap.kind);
    if (!region || !file) throw new Error(`il ${swap.region} ${swap.kind} parçası manifestte yok`);
    const meta = read(swap.source);
    const path = `${swap.region}/${swap.kind}-${meta.sha256.slice(0, 8)}${file.path.slice(file.path.lastIndexOf('.'))}`;
    added.push({ from: swap.source, to: path });
    file.path = path;
    file.sha256 = meta.sha256;
    file.size = meta.size;
    if (meta.blocks) file.blocks = meta.blocks;
    else delete file.blocks;
  }
  return { manifest: next, added };
}

function describe(path: string) {
  const bytes = readFileSync(path);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: statSync(path).size, blocks: blocksOf(path) };
}

function link(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name), base) : [join(dir, entry.name).slice(base.length + 1)]));
}

export function makeAltPacks(source: string, target: string, swaps: Swap[], privateKeyPem: string): { files: number; added: number } {
  const manifest = parseManifest(readFileSync(join(source, 'manifest-v1.json'), 'utf8'));
  const { manifest: next, added } = swapFiles(manifest, swaps, describe);
  rmSync(target, { recursive: true, force: true });
  const skip = new Set(['manifest-v1.json', 'manifest-v1.json.sig']);
  let files = 0;
  for (const relative of walk(source)) {
    if (skip.has(relative)) continue;
    link(join(source, relative), join(target, relative));
    files += 1;
  }
  for (const item of added) link(item.from, join(target, item.to));
  const text = serializeManifest(next);
  writeFileSync(join(target, 'manifest-v1.json'), text);
  writeFileSync(join(target, 'manifest-v1.json.sig'), signManifest(text, privateKeyPem));
  const publicKey = join(source, 'dev-public-key.pem');
  if (existsSync(publicKey)) copyFileSync(publicKey, join(target, 'dev-public-key.pem'));
  return { files, added: added.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [source, target, ...rest] = process.argv.slice(2);
  const swaps: Swap[] = rest.map((item) => {
    const [region, file] = item.split('=');
    if (!region || !file) throw new Error('kullanım: make-alt-packs <kaynak> <hedef> <il>=<yeni places.pmtiles> ...');
    return { region, kind: 'places', source: file };
  });
  if (!source || !target || swaps.length === 0) throw new Error('kullanım: make-alt-packs <kaynak> <hedef> <il>=<yeni places.pmtiles> ...');
  const result = makeAltPacks(source, target, swaps, readFileSync(join(defaultKeyDir(), 'dev-signing.key'), 'utf8'));
  console.log(`${result.files} dosya bağlandı, ${result.added} dosya değişti, manifest imzalandı: ${target}`);
}
