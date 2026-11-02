import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import config from '../config/overture.json';
import type { Runner } from './tiles';

export type OvertureInput = {
  release: string;
  plates: string[];
  workDir: string;
  cacheDir: string;
  python: string;
  script: string;
  borders: string;
  pbf?: string;
  run: Runner;
  log?: (line: string) => void;
};

export type OvertureResult = { files: Record<string, string>; kept: Record<string, number> };

const PLATE_COUNT = 81;

export const overtureRelease = (): string => config.release;

export async function buildOverturePlaces(input: OvertureInput): Promise<OvertureResult> {
  const out = join(input.workDir, 'overture');
  const wanted = input.plates.length === PLATE_COUNT ? 'all' : input.plates.join(',');
  const extract = await input.run(input.python, [input.script, '--release', input.release, '--borders', input.borders, '--out', out, '--cache', input.cacheDir, '--plates', wanted, ...(input.pbf ? ['--pbf', input.pbf, '--buildings', join(input.workDir, 'building-index.npz')] : [])]);
  if (extract.code !== 0) throw new Error(`overture_places.py: ${extract.out.slice(-600)}`);
  const summary = JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) as { plates: Record<string, { kept: number; minzoom: number | null }> };
  const files: Record<string, string> = {};
  const kept: Record<string, number> = {};
  for (const plate of [...input.plates].sort()) {
    const row = summary.plates[plate];
    kept[plate] = row?.kept ?? 0;
    if (!row || row.kept === 0 || row.minzoom === null) continue;
    const temporary = `${plate}.build.pmtiles`;
    const command = `cd '${out}' && tippecanoe -o '${temporary}' -l places -Z${row.minzoom} -z16 --force --no-tile-size-limit --no-feature-limit --quiet '${plate}.geojsonl'`;
    const built = join(out, temporary);
    let made = await input.run('/bin/sh', ['-c', command]);
    if (made.code !== 0) {
      rmSync(built, { force: true });
      made = await input.run('/bin/sh', ['-c', command]);
    }
    if (made.code !== 0) {
      rmSync(built, { force: true });
      throw new Error(`${plate}: ${made.out.slice(-600)}`);
    }
    if (!existsSync(built)) throw new Error(`${plate}: karo dosyası oluşmadı`);
    renameSync(built, join(out, `${plate}.pmtiles`));
    files[plate] = join(out, `${plate}.pmtiles`);
    input.log?.(`işletmeler ${plate}: ${row.kept} yer`);
  }
  return { files, kept };
}
