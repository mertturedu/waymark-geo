import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildNeighbourhoodPack, readHoodRows, writeNeighbourhoodPack } from '../pipeline/build/neighbourhood-pack';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function main(): void {
  const csv = arg('csv');
  const out = resolve(arg('out') ?? 'dist/neighbourhoods');
  const source = arg('source');
  if (!csv || !source) {
    console.error('usage: npm run data:neighbourhoods -- --csv <file> --source "<where the data comes from>" [--out dist/neighbourhoods] [--strict]');
    process.exit(2);
  }
  const build = buildNeighbourhoodPack(readHoodRows(readFileSync(csv, 'utf8')), source);
  const { files, checksum } = writeNeighbourhoodPack(build, out);
  const reasons: Record<string, number> = {};
  for (const r of build.rejected) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  writeFileSync(join(out, '..', 'neighbourhoods-report.json'), JSON.stringify({ ...build.stats, rejected: build.rejected.length, reasons, checksum, files: files.length, sample: build.rejected.slice(0, 50) }, null, 2));
  console.log(`${build.stats.kept}/${build.stats.rows} rows, ${build.stats.provinces} provinces, ${build.stats.districts} districts, ${build.stats.postcodes} postcodes -> ${files.length} files in ${out}`);
  if (build.rejected.length > 0) console.log(`rejected ${build.rejected.length}:`, reasons);
  if (process.argv.includes('--strict') && build.rejected.length > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
