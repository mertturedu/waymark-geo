import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultKeyDir, signManifest } from '../pipeline/build/manifest';
import { archivePack, makePatches, type PatchFile } from '../pipeline/build/patches';
import { parseManifest, serializeManifest, type Manifest } from '../src/core/region/manifest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const argument = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? (process.argv[at + 1] ?? fallback) : fallback;
};

const releases = join(repoRoot, 'dist', 'releases');
const newTag = argument('--new', '20261028.20261030.3');
const oldTag = argument('--old', '20261028.20261029');
const ids = argument('--regions', '16,34').split(',');
const out = argument('--out', join(repoRoot, 'dist', 'patch-test'));
const before = join(out, 'before');

const read = (tag: string): Manifest => parseManifest(readFileSync(join(releases, tag, 'packs', 'manifest-v1.json'), 'utf8'));
const link = (source: string, target: string): void => {
  mkdirSync(dirname(target), { recursive: true });
  try {
    linkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
};
const only = (manifest: Manifest): Manifest => ({ ...manifest, base: [], regions: manifest.regions.filter((region) => ids.includes(region.id)) });
const privateKey = readFileSync(join(defaultKeyDir(), 'dev-signing.key'), 'utf8');
const write = (dir: string, manifest: Manifest): void => {
  const text = serializeManifest(manifest);
  writeFileSync(join(dir, 'manifest-v1.json'), text);
  writeFileSync(join(dir, 'manifest-v1.json.sig'), signManifest(text, privateKey));
};

rmSync(out, { recursive: true, force: true });
mkdirSync(before, { recursive: true });

const fresh = only(read(newTag));
const older = only(read(oldTag));
for (const [manifest, tag, dir] of [[older, oldTag, before], [fresh, newTag, out]] as const) {
  for (const region of manifest.regions) {
    for (const file of region.files) {
      link(join(releases, tag, 'packs', file.path), join(dir, file.path));
      if (file.encoded) link(join(releases, tag, 'packs', file.encoded.path), join(dir, file.encoded.path));
    }
  }
}

const archiveDir = join(out, '.work', 'archive');
archivePack(join(releases, oldTag, 'packs'), archiveDir);
const files: PatchFile[] = fresh.regions.flatMap((region) =>
  region.files.map((file) => ({ regionId: region.id, kind: file.kind, path: file.path, size: file.size, sha256: file.sha256, download: file.encoded?.size ?? file.size, source: join(releases, newTag, 'packs', file.path) })),
);
const made = await makePatches(files, { outDir: out, archiveDir, cacheDir: join(out, '.work', 'cache'), tmpDir: join(out, '.work', 'tmp'), concurrency: 6, log: (line) => console.log(line) });
for (const region of fresh.regions) for (const file of region.files) if (made.patches.has(file.path)) file.patches = made.patches.get(file.path);
write(before, older);
write(out, fresh);
rmSync(join(out, '.work'), { recursive: true, force: true });
if (!existsSync(join(out, 'manifest-v1.json'))) throw new Error('manifest yazılamadı');

const MB = 1e6;
for (const region of fresh.regions) {
  const full = region.files.reduce((sum, file) => sum + (file.encoded?.size ?? file.size), 0);
  const patch = region.files.reduce((sum, file) => sum + (file.patches?.find((item) => item.from === older.regions.find((r) => r.id === region.id)?.files.find((f) => f.kind === file.kind)?.sha256)?.size ?? file.encoded?.size ?? file.size), 0);
  console.log(`${region.id}: ${oldTag} -> ${newTag}: tam ${(full / MB).toFixed(1)} MB, yamayla ${(patch / MB).toFixed(1)} MB`);
}
console.log(`yama: ${made.stats.made} üretildi, ${made.stats.tooBig} büyük, ${made.stats.skippedSmall} küçük, ${made.stats.unverified} doğrulanamadı, ${(made.stats.bytes / MB).toFixed(1)} MB; çıktı ${out}`);
