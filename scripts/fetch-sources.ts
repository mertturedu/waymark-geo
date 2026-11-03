import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveBuildDate } from './make-test-data';

export type Sources = { osmFile: string; osmMd5: string; osmTimestamp: string; tilesBuild: string; tilesOsmTime: string; revision?: number };

export const revisionSuffix = (sources: Pick<Sources, 'revision'>): string => (sources.revision !== undefined && Number.isInteger(sources.revision) && sources.revision > 1 ? `.${sources.revision}` : '');

const GEOFABRIK = 'https://download.geofabrik.de/europe';
const DATED = /^turkey-(\d{2})(\d{2})(\d{2})\.osm\.pbf$/;

export function parseGeofabrikName(name: string): { date: string } | null {
  const match = DATED.exec(name);
  if (!match) return null;
  const [, yy, mm, dd] = match;
  const month = Number(mm);
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { date: `20${yy}-${mm}-${dd}` };
}

export function verifyMd5(path: string, expected: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex') === expected.trim().toLowerCase()));
  });
}

export function gapDays(a: string, b: string): number {
  return Math.round((Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000) * 10) / 10;
}

export function renderSources(s: Sources): string {
  const ordered: Sources = { osmFile: s.osmFile, osmMd5: s.osmMd5, osmTimestamp: s.osmTimestamp, tilesBuild: s.tilesBuild, tilesOsmTime: s.tilesOsmTime, ...(revisionSuffix(s) !== '' ? { revision: s.revision as number } : {}) };
  return JSON.stringify(ordered, null, 2) + '\n';
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function osmTimestamp(pbf: string): string {
  const run = spawnSync('/opt/homebrew/bin/osmium', ['fileinfo', '-g', 'header.option.osmosis_replication_timestamp', pbf], { encoding: 'utf8' });
  const value = run.stdout.trim();
  if (run.status !== 0 || !value) throw new Error(`OSM zamanı okunamadı: ${pbf}`);
  return value;
}

function tilesOsmTime(build: string): string {
  const run = spawnSync(join(repoRoot, 'pipeline', 'bin', 'pmtiles'), ['show', `https://build.protomaps.com/${build}.pmtiles`], { encoding: 'utf8' });
  const value = /planetiler:osm:osmosisreplicationtime\s+(\S+)/.exec(run.stdout)?.[1];
  if (run.status !== 0 || !value) throw new Error(`karo derlemesinin OSM zamanı okunamadı: ${build}`);
  return value;
}

async function main(): Promise<void> {
  const at = process.argv.indexOf('--pbf');
  const source = at >= 0 ? process.argv[at + 1] : undefined;
  if (!source || !existsSync(source)) throw new Error('kullanım: npm run data:sources -- --pbf <dosya>');
  const timestamp = osmTimestamp(source);
  const day = timestamp.slice(0, 10).replace(/-/g, '').slice(2);
  const osmFile = `turkey-${day}.osm.pbf`;
  if (!parseGeofabrikName(osmFile)) throw new Error(`geçersiz ad: ${osmFile}`);
  const response = await fetch(`${GEOFABRIK}/${osmFile}.md5`);
  if (!response.ok) throw new Error(`${osmFile}.md5: HTTP ${response.status}`);
  const osmMd5 = (await response.text()).trim().split(/\s+/)[0] ?? '';
  if (!(await verifyMd5(source, osmMd5))) throw new Error(`${source}: md5 Geofabrik ile uyuşmuyor`);
  const dataDir = join(repoRoot, 'pipeline', 'data');
  mkdirSync(dataDir, { recursive: true });
  const target = join(dataDir, osmFile);
  if (!existsSync(target)) copyFileSync(source, target);
  const tilesBuild = await resolveBuildDate(async (date) => (await fetch(`https://build.protomaps.com/${date}.pmtiles`, { method: 'HEAD' })).ok, new Date(), 7);
  const sources: Sources = { osmFile, osmMd5, osmTimestamp: timestamp, tilesBuild, tilesOsmTime: tilesOsmTime(tilesBuild) };
  writeFileSync(join(dataDir, 'sources.json'), renderSources(sources));
  console.log(renderSources(sources) + `OSM ile karo arası ${gapDays(sources.osmTimestamp, sources.tilesOsmTime)} gün`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
