import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { seededBytes } from './spikes/blob';

export type ManifestFile = { path: string; size: number; sha256: string };
export type Manifest = { protomapsBuild: string; files: ManifestFile[] };

const ASSETS_COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7';
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const FONT_RANGES = Array.from({ length: 256 }, (_, i) => `${i * 256}-${i * 256 + 255}`);
const SPRITES = ['light', 'dark'].flatMap((flavor) => [`${flavor}.json`, `${flavor}.png`, `${flavor}@2x.json`, `${flavor}@2x.png`]);

export const formatDate = (date: Date): string => date.toISOString().slice(0, 10).replace(/-/g, '');

export async function resolveBuildDate(probe: (date: string) => Promise<boolean>, today: Date, maxBack: number): Promise<string> {
  for (let back = 0; back <= maxBack; back++) {
    const date = formatDate(new Date(today.getTime() - back * 86_400_000));
    if (await probe(date)) return date;
  }
  throw new Error(`Protomaps build bulunamadı (son ${maxBack} gün)`);
}

export const seededBlob = (seed: number, size: number): Buffer => Buffer.from(seededBytes(seed, size));

export function assetList(): { url: string; path: string }[] {
  const base = `https://raw.githubusercontent.com/protomaps/basemaps-assets/${ASSETS_COMMIT}`;
  const fonts = FONT_STACKS.flatMap((stack) =>
    FONT_RANGES.map((range) => ({ url: `${base}/fonts/${encodeURIComponent(stack)}/${range}.pbf`, path: `fonts/${stack}/${range}.pbf` })),
  );
  const compact = fonts.map((font) => ({ url: font.url, path: font.path.replace('fonts/', 'fonts-compact/').replace(/Noto Sans /, 'NotoSans') }));
  const sprites = SPRITES.map((name) => ({ url: `${base}/sprites/v4/${encodeURIComponent(name)}`, path: `sprites/v4/${name}` }));
  return [...fonts, ...compact, ...sprites];
}

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

const listFiles = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')]))
    .filter((path) => path !== 'manifest.json')
    .sort();

export async function buildManifest(root: string, protomapsBuild: string): Promise<Manifest> {
  const files: ManifestFile[] = [];
  for (const path of listFiles(root)) files.push({ path, size: statSync(join(root, path)).size, sha256: await hashFile(join(root, path)) });
  return { protomapsBuild, files };
}

export async function verifyManifest(root: string, manifest: Manifest): Promise<string[]> {
  const problems: string[] = [];
  for (const file of manifest.files) {
    const full = join(root, file.path);
    if (!existsSync(full)) problems.push(`${file.path}: dosya yok`);
    else if (statSync(full).size !== file.size) problems.push(`${file.path}: boyut uyuşmuyor`);
    else if ((await hashFile(full)) !== file.sha256) problems.push(`${file.path}: sha256 uyuşmuyor`);
  }
  return problems;
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const pmtiles = (args: string[]) => spawnSync(join(repoRoot, 'pipeline', 'bin', 'pmtiles'), args, { encoding: 'utf8' });

function extract(build: string, bbox: string, out: string, expectMB?: [number, number]): void {
  const source = `https://build.protomaps.com/${build}.pmtiles`;
  const common = ['extract', source, out, `--bbox=${bbox}`, '--maxzoom=15'];
  if (expectMB) {
    const dry = pmtiles([...common, '--dry-run']);
    const size = /for an archive size of ([\d.]+) MB/.exec(dry.stdout + dry.stderr);
    if (!size) throw new Error(`dry-run çıktısı okunamadı: ${(dry.stdout + dry.stderr).slice(-300)}`);
    const mb = Number(size[1]);
    if (mb < expectMB[0] || mb > expectMB[1]) throw new Error(`${out} beklenen aralığın dışında: ${mb} MB`);
  }
  const run = pmtiles(common);
  if (run.status !== 0) throw new Error(`pmtiles extract başarısız: ${(run.stdout + run.stderr).slice(-300)}`);
}

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

async function main(): Promise<void> {
  const out = join(repoRoot, 'dist', 'test-data');
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--manifest-only')) {
    const existing = existsSync(join(out, 'manifest.json')) ? (JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Manifest) : null;
    const manifest = await buildManifest(out, existing?.protomapsBuild ?? 'unknown');
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return;
  }
  const build = await resolveBuildDate(
    async (date) => (await fetch(`https://build.protomaps.com/${date}.pmtiles`, { method: 'HEAD' })).ok,
    new Date(),
    14,
  );
  console.log(`protomaps build ${build}`);
  if (!existsSync(join(out, 'istanbul-kadikoy.pmtiles'))) extract(build, '29.00,40.96,29.10,41.02', join(out, 'istanbul-kadikoy.pmtiles'));
  if (!existsSync(join(out, 'istanbul.pmtiles'))) extract(build, '27.9,40.7,29.99,41.65', join(out, 'istanbul.pmtiles'), [70, 90]);
  for (const asset of assetList()) if (!existsSync(join(out, asset.path))) await download(asset.url, join(out, asset.path));
  if (!existsSync(join(out, 'blob-30mb.bin'))) writeFileSync(join(out, 'blob-30mb.bin'), seededBlob(42, 30 * 1024 * 1024));
  const manifest = await buildManifest(out, build);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const problems = await verifyManifest(out, manifest);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(`${manifest.files.length} dosya, manifest yazıldı`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
