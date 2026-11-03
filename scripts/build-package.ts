import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const COPIED = [/\.png$/, /(^|\/)assets\.d\.ts$/];
const SKIPPED = ['src/node'];

export function assetsToCopy(files: readonly string[]): string[] {
  return files.filter((file) => !SKIPPED.some((dir) => file === dir || file.startsWith(`${dir}/`)) && COPIED.some((pattern) => pattern.test(file))).sort();
}

function walk(dir: string, base: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full, base) : [relative(base, full).split('\\').join('/')];
  });
}

export function buildPackage(options: { tsc?: (cwd: string) => void } = {}): { files: number; copied: number } {
  const lib = join(root, 'lib');
  rmSync(lib, { recursive: true, force: true });
  (options.tsc ?? ((cwd) => void execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd, stdio: 'inherit' })))(root);
  const wanted = assetsToCopy(walk(join(root, 'src'), root));
  for (const file of wanted) {
    const target = join(lib, file.slice('src/'.length));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  if (!existsSync(join(lib, 'index.js'))) throw new Error('lib/index.js üretilmedi');
  return { files: walk(lib, lib).length, copied: wanted.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildPackage();
  console.log(`lib hazır: ${result.files} dosya (${result.copied} varlık kopyalandı)`);
}
