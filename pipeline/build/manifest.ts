import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { closeSync, copyFileSync, createReadStream, openSync, readSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { serializeManifest, type Box, type FileBlocks, type Manifest, type ManifestFile, type ManifestRegion, type Tier } from '../../src/core/region/manifest';
import type { Sources } from '../../scripts/fetch-sources';

export type RegionInput = {
  id: string;
  tier: Tier;
  names: Record<string, string>;
  bbox: Box;
  stats: { addresses: number; streets: number; neighbourhoods: number };
  files: { kind: 'address' | 'tiles' | 'route' | 'buildings' | 'places' | 'directory'; source: string }[];
};

export const defaultKeyDir = (): string => join(homedir(), '.yuksi-geo');
const EXTENSION: Record<string, string> = { address: 'sqlite', tiles: 'pmtiles', route: 'bin', buildings: 'sqlite', places: 'pmtiles', directory: 'sqlite' };

export function ensureDevKey(dir: string): { publicKeyPem: string; created: boolean } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'dev-signing.key');
  let created = false;
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(path, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    created = true;
  }
  const publicKey = createPublicKey(createPrivateKey(readFileSync(path)));
  return { publicKeyPem: String(publicKey.export({ type: 'spki', format: 'pem' })), created };
}

export function signManifest(text: string, privateKeyPem: string): string {
  try {
    return sign(null, Buffer.from(text, 'utf8'), createPrivateKey(privateKeyPem)).toString('base64') + '\n';
  } catch {
    throw new Error('imza anahtarı okunamadı');
  }
}

export const BLOCK_SIZE = 4 * 1024 * 1024;
const BLOCK_MIN_FILE = 8 * 1024 * 1024;

export function blocksOf(path: string): FileBlocks | undefined {
  const size = statSync(path).size;
  if (size <= BLOCK_MIN_FILE) return undefined;
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(BLOCK_SIZE);
    const sha256: string[] = [];
    for (let offset = 0; offset < size; offset += BLOCK_SIZE) {
      const read = readSync(fd, buffer, 0, Math.min(BLOCK_SIZE, size - offset), offset);
      sha256.push(createHash('sha256').update(buffer.subarray(0, read)).digest('hex'));
    }
    return { size: BLOCK_SIZE, sha256 };
  } finally {
    closeSync(fd);
  }
}

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

const withBlocks = (path: string): { blocks?: FileBlocks } => {
  const blocks = blocksOf(path);
  return blocks ? { blocks } : {};
};

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')]));
}

function place(source: string, target: string): void {
  if (existsSync(target) && statSync(target).size === statSync(source).size) return;
  mkdirSync(dirname(target), { recursive: true });
  try {
    linkSync(source, `${target}.tmp`);
  } catch {
    copyFileSync(source, `${target}.tmp`);
  }
  renameSync(`${target}.tmp`, target);
}

export async function assemblePacks(input: { outDir: string; sources: Sources; regions: RegionInput[]; baseDir: string; keyDir: string; minSdk: string }): Promise<{ files: number; manifestBytes: number }> {
  const ids = new Set<string>();
  for (const region of input.regions) {
    if (ids.has(region.id)) throw new Error(`bölge ${region.id} iki kez verildi (twice)`);
    ids.add(region.id);
  }
  const { publicKeyPem } = ensureDevKey(input.keyDir);
  const privateKeyPem = readFileSync(join(input.keyDir, 'dev-signing.key'), 'utf8');
  mkdirSync(input.outDir, { recursive: true });
  const day = input.sources.osmTimestamp.slice(0, 10).replace(/-/g, '');
  let count = 0;

  const base: ManifestFile[] = [];
  for (const rel of listFiles(input.baseDir).filter((p) => !p.endsWith('.tmp')).sort()) {
    const source = join(input.baseDir, rel);
    const path = `base-${input.sources.tilesBuild}/${rel}`;
    place(source, join(input.outDir, path));
    base.push({ kind: 'base', path, size: statSync(source).size, sha256: await hashFile(source), ...withBlocks(source) });
    count += 1;
  }

  const regions: ManifestRegion[] = [];
  for (const region of [...input.regions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const files: ManifestFile[] = [];
    for (const item of [...region.files].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))) {
      const sha256 = await hashFile(item.source);
      const path = `${region.id}/${item.kind}-${sha256.slice(0, 8)}.${EXTENSION[item.kind]}`;
      place(item.source, join(input.outDir, path));
      files.push({ kind: item.kind, path, size: statSync(item.source).size, sha256, ...withBlocks(item.source) });
      count += 1;
    }
    regions.push({ id: region.id, tier: region.tier, names: region.names, bbox: region.bbox, version: `${day}.${input.sources.tilesBuild}`, stats: region.stats, files });
  }

  const manifest: Manifest = {
    format: 1,
    minSdk: input.minSdk,
    osm: { file: input.sources.osmFile, time: input.sources.osmTimestamp },
    tiles: { build: input.sources.tilesBuild, time: input.sources.tilesOsmTime },
    base,
    regions,
  };
  const text = serializeManifest(manifest);
  writeFileSync(join(input.outDir, 'dev-public-key.pem'), publicKeyPem);
  const manifestPath = join(input.outDir, 'manifest-v1.json');
  writeFileSync(`${manifestPath}.sig.tmp`, signManifest(text, privateKeyPem));
  writeFileSync(`${manifestPath}.tmp`, text);
  renameSync(`${manifestPath}.sig.tmp`, `${manifestPath}.sig`);
  renameSync(`${manifestPath}.tmp`, manifestPath);
  rmSync(`${manifestPath}.sig.tmp`, { force: true });
  return { files: count, manifestBytes: Buffer.byteLength(text) };
}
