import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export type PublishPlan = { tag: string; files: { path: string; size: number }[]; total: number };

export function listRelease(packs: string): PublishPlan['files'] {
  const out: PublishPlan['files'] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push({ path: full.slice(packs.length + 1), size: statSync(full).size });
    }
  };
  walk(packs);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function planPublish(releasesDir: string, tag?: string): PublishPlan | null {
  const tags = existsSync(releasesDir) ? readdirSync(releasesDir).filter((t) => existsSync(join(releasesDir, t, 'packs', 'manifest-v1.json'))).sort() : [];
  const chosen = tag ?? tags[tags.length - 1];
  if (!chosen || !tags.includes(chosen)) return null;
  const files = listRelease(join(releasesDir, chosen, 'packs'));
  return { tag: chosen, files, total: files.reduce((a, f) => a + f.size, 0) };
}

export function main(argv: string[]): number {
  const confirm = argv.includes('--confirm');
  const tagAt = argv.indexOf('--tag');
  const targetAt = argv.indexOf('--target');
  const releases = join(repoRoot, 'dist', 'releases');
  const plan = planPublish(releases, tagAt >= 0 ? argv[tagAt + 1] : undefined);
  if (!plan) {
    console.error('yayınlanacak sürüm yok (önce npm run data:release)');
    return 1;
  }
  console.log(`sürüm ${plan.tag}: ${plan.files.length} dosya, ${(plan.total / 1e6).toFixed(0)} MB`);
  const manifest = JSON.parse(readFileSync(join(releases, plan.tag, 'packs', 'manifest-v1.json'), 'utf8')) as { regions: unknown[] };
  console.log(`manifest ${manifest.regions.length} il listeliyor`);
  if (!confirm) {
    console.log('kuru çalıştırma: hiçbir şey yayınlanmadı. Yayın için kullanıcı onayıyla: npm run data:publish -- --confirm --target <yuksi-geo-data klasörü>');
    return 0;
  }
  const target = targetAt >= 0 ? argv[targetAt + 1] : undefined;
  if (!target || !existsSync(target)) {
    console.error('--target, yuksi-geo-data deposunun yerel kopyası olmalı ve var olmalı');
    return 1;
  }
  mkdirSync(join(target, plan.tag), { recursive: true });
  cpSync(join(releases, plan.tag, 'packs'), join(target, plan.tag), { recursive: true });
  console.log(`dosyalar ${join(target, plan.tag)} içine kopyalandı. Etiket ve push elle yapılır: git add . && git commit && git tag ${plan.tag}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
