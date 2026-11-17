import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodeBorders, type BorderRow } from '../src/core/region/borders';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function writeBordersModule(binPath: string, modulePath: string): { bytes: number } {
  const bytes = readFileSync(binPath);
  writeFileSync(`${modulePath}.tmp`, `export const BORDERS_BASE64 = '${bytes.toString('base64')}';\n`);
  renameSync(`${modulePath}.tmp`, modulePath);
  return { bytes: bytes.length };
}

export function buildBordersFile(inputPath: string, outPath: string): { bytes: number; provinces: number } {
  const rows: BorderRow[] = [];
  readFileSync(inputPath, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      try {
        rows.push(JSON.parse(line) as BorderRow);
      } catch {
        throw new Error(`${inputPath}:${index + 1}: satır okunamadı`);
      }
    });
  const bytes = encodeBorders(rows);
  writeFileSync(`${outPath}.tmp`, bytes);
  renameSync(`${outPath}.tmp`, outPath);
  return { bytes: bytes.length, provinces: rows.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2] ?? join(repoRoot, 'dist', 'work', '261020', 'borders.jsonl');
  const out = process.argv[3] ?? join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin');
  const built = buildBordersFile(input, out);
  const embedded = writeBordersModule(out, join(dirname(out), 'borders-base64.ts'));
  console.log(JSON.stringify({ ...built, embedded: embedded.bytes }));
}
