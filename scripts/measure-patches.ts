import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivePack, makePatches, versionOf, type PatchFile, type PatchStats } from '../pipeline/build/patches';
import { parseManifest, type ManifestPatch } from '../src/core/region/manifest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const argument = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const releases = join(repoRoot, 'dist', 'releases');
const newTag = argument('--new');
const oldTags = (argument('--old') ?? '').split(',').filter((tag) => tag !== '');
const lanes = Number(argument('--lanes') ?? '6');
const rounds = Number(argument('--rounds') ?? '2');
const only = argument('--regions')?.split(',');
const work = argument('--work') ?? join(repoRoot, 'dist', 'patch-measure');
if (!newTag || oldTags.length === 0) {
  console.error('kullanım: tsx scripts/measure-patches.ts --new <sürüm> --old <sürüm,sürüm> [--lanes 6] [--rounds 2] [--regions 16,34] [--work klasör]');
  process.exit(1);
}

const manifestOf = (tag: string) => parseManifest(readFileSync(join(releases, tag, 'packs', 'manifest-v1.json'), 'utf8'));
const MB = 1e6;
const fresh = manifestOf(newTag);
const keep = (id: string): boolean => only === undefined || only.includes(id);

rmSync(work, { recursive: true, force: true });
const archiveDir = join(work, 'archive');
for (const tag of oldTags) archivePack(join(releases, tag, 'packs'), archiveDir);

const files: PatchFile[] = fresh.regions.filter((region) => keep(region.id)).flatMap((region) =>
  region.files.map((file) => ({ regionId: region.id, kind: file.kind, path: file.path, size: file.size, sha256: file.sha256, download: file.encoded?.size ?? file.size, source: join(releases, newTag, 'packs', file.path) })),
);

async function round(name: string): Promise<{ patches: Map<string, ManifestPatch[]>; stats: PatchStats; disk: number }> {
  const out = join(work, `out-${name}`);
  mkdirSync(out, { recursive: true });
  const made = await makePatches(files, { outDir: out, archiveDir, cacheDir: join(work, `cache-${name}`), tmpDir: join(work, `tmp-${name}`), keep: oldTags.length, concurrency: lanes, log: (line) => console.log(line) });
  const disk = [...made.patches.values()].flat().reduce((sum, patch) => sum + statSync(join(out, patch.path)).size, 0);
  return { ...made, disk };
}

console.log(`yeni ${newTag}, eski ${oldTags.join(', ')}, ${files.length} dosya, ${lanes} hat`);
const first = await round('bir');
console.log(`1. koşu: ${JSON.stringify(first.stats)}`);
if (rounds > 1) {
  const second = await round('iki');
  console.log(`2. koşu (boş önbellekle): ${JSON.stringify(second.stats)}`);
  const same = JSON.stringify([...first.patches.entries()].sort()) === JSON.stringify([...second.patches.entries()].sort());
  console.log(`Y2.1 determinizm (iki koşunun yama listesi ve özetleri): ${same ? 'AYNI' : 'FARKLI'}`);
}

const kinds = [...new Set(files.map((file) => file.kind))].sort();
console.log('\nTür bazında (yeni sürümün tüm dosyaları, tam indirme = sıkıştırılmış boyut):');
for (const kind of kinds) {
  const list = files.filter((file) => file.kind === kind);
  const patched = list.filter((file) => first.patches.has(file.path));
  const patchBytes = patched.reduce((sum, file) => sum + (first.patches.get(file.path) ?? []).reduce((s, p) => s + p.size, 0), 0);
  console.log(`  ${kind.padEnd(10)} ${String(list.length).padStart(3)} dosya, ${String(patched.length).padStart(3)} yamalı, tam ${(list.reduce((s, f) => s + f.download, 0) / MB).toFixed(0).padStart(6)} MB, yamalar toplam ${(patchBytes / MB).toFixed(0).padStart(6)} MB`);
}

console.log('\nTelefondaki eski sürüme göre toplam indirme (taban/base dosyaları hariç):');
for (const tag of oldTags) {
  const old = manifestOf(tag);
  let full = 0;
  let withPatches = 0;
  let used = 0;
  let changed = 0;
  for (const file of files) {
    const before = old.regions.find((region) => region.id === file.regionId)?.files.find((item) => item.kind === file.kind);
    if (!before) {
      full += file.download;
      withPatches += file.download;
      continue;
    }
    if (before.sha256 === file.sha256) continue;
    changed += 1;
    full += file.download;
    const patch = (first.patches.get(file.path) ?? []).find((item) => item.from === before.sha256);
    if (patch) used += 1;
    withPatches += patch ? patch.size : file.download;
  }
  console.log(`  ${tag} (${versionOf(old)}): değişen ${changed} dosya, yamayla ${used} tanesi. Bugün ${(full / MB).toFixed(0)} MB → yamayla ${(withPatches / MB).toFixed(0)} MB (−%${full === 0 ? 0 : Math.round((1 - withPatches / full) * 100)})`);
}

console.log(`\nY2.3 süre: ${(first.stats.ms / 1000).toFixed(0)} sn (${lanes} hat), yama diski: ${(first.disk / MB).toFixed(0)} MB, önbellek ek diski aynı boyutta`);
console.log(`Y2.2 geri uygulama: ${first.stats.made + first.stats.cached} yama doğrulandı, ${first.stats.unverified} tutmadı`);
