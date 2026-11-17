import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { repoRoot } from './addr-sets';

export const COUNTRY_DIR = join(repoRoot, 'dist', 'country-base');
const PACKS = join(repoRoot, 'dist', 'work', '261028', 'packs');

export function slimPack(source: string, target: string): { before: number; after: number } {
  mkdirSync(join(target, '..'), { recursive: true });
  rmSync(target, { force: true });
  copyFileSync(source, target);
  const db = new DatabaseSync(target);
  try {
    db.exec('DELETE FROM address; DELETE FROM poi; DELETE FROM search_name WHERE kind = 1;');
    db.exec('VACUUM');
  } finally {
    db.close();
  }
  return { before: statSync(source).size, after: statSync(target).size };
}

if (process.argv[1]?.endsWith('build-country-base.ts')) {
  const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
  const plates = arg ? arg.split(',') : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  let before = 0;
  let after = 0;
  for (const plate of plates) {
    const source = join(PACKS, plate, 'address.sqlite');
    if (!existsSync(source)) continue;
    const sizes = slimPack(source, join(COUNTRY_DIR, plate, 'address.sqlite'));
    before += sizes.before;
    after += sizes.after;
  }
  console.log(JSON.stringify({ plates: plates.length, fullMB: Math.round(before / 1e5) / 10, slimMB: Math.round(after / 1e5) / 10 }));
}
