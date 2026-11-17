import { createHash } from 'node:crypto';
import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blocksOf, defaultKeyDir, ensureDevKey, signManifest } from '../pipeline/build/manifest';
import { gzipStable, openPmtiles, writePmtiles } from '../pipeline/build/pmtiles-file';
import { splitRoadsInTile } from '../pipeline/build/road-cells';
import { gunzipSync } from 'node:zlib';
import { parseManifest, serializeManifest } from '../src/core/region/manifest';

const [source, target, plate = '34'] = process.argv.slice(2);
if (!source || !target) {
  console.error('kullanım: split-road-cells <paket klasörü> <çıktı klasörü> [plaka]');
  process.exit(1);
}

const manifest = parseManifest(readFileSync(join(source, 'manifest-v1.json'), 'utf8'));
const region = manifest.regions.find((r) => r.id === plate);
const file = region?.files.find((f) => f.kind === 'tiles');
if (!region || !file) {
  console.error(`${plate} için karo dosyası yok`);
  process.exit(1);
}

const linkTree = (from: string, to: string): void => {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const a = join(from, name);
    const b = join(to, name);
    if (statSync(a).isDirectory()) linkTree(a, b);
    else linkSync(a, b);
  }
};
rmSync(target, { recursive: true, force: true });
linkTree(source, target);

const archive = openPmtiles(join(source, file.path));
const { header } = archive;
const gz = header.tileCompression === 2;
const tiles: { tileId: number; data: Uint8Array }[] = [];
let split = 0;
let changed = 0;
for (const entry of archive.entries) {
  const data = archive.read(entry);
  for (let i = 0; i < entry.runLength; i++) {
    const tileId = entry.tileId + i;
    const result = splitRoadsInTile(gz ? gunzipSync(data) : data, tileId);
    if (result === null) {
      tiles.push({ tileId, data });
      continue;
    }
    split += result.split;
    changed += 1;
    tiles.push({ tileId, data: gz ? gzipStable(result.data) : result.data });
  }
}
const temporary = join(target, plate, 'tiles-cells.pmtiles');
writePmtiles(temporary, { tileCompression: header.tileCompression, tileType: header.tileType, minZoom: header.minZoom, maxZoom: header.maxZoom, boundsE7: header.boundsE7, centerZoom: header.centerZoom, centerE7: header.centerE7 }, { ...archive.metadata, 'yuksi:road-cells': '6' }, tiles);
archive.close();

const bytes = readFileSync(temporary);
const sha = createHash('sha256').update(bytes).digest('hex');
const name = `${plate}/tiles-${sha.slice(0, 8)}.pmtiles`;
rmSync(join(target, file.path), { force: true });
renameSync(temporary, join(target, name));
file.path = name;
file.sha256 = sha;
file.size = bytes.length;
const blocks = blocksOf(join(target, name));
if (blocks) file.blocks = blocks;

ensureDevKey(defaultKeyDir());
const text = serializeManifest(manifest);
rmSync(join(target, 'manifest-v1.json'), { force: true });
rmSync(join(target, 'manifest-v1.json.sig'), { force: true });
writeFileSync(join(target, 'manifest-v1.json'), text);
writeFileSync(join(target, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(defaultKeyDir(), 'dev-signing.key'), 'utf8')));
console.log(`${changed} karoda ${split} yol parçası hücreye bölündü; ${(file.size / 1e6).toFixed(1)} MB`);
