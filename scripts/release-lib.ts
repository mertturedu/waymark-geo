import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { revisionSuffix, type Sources } from './fetch-sources';

export const MAX_SOURCE_AGE_DAYS = 7;
export const MAX_SOURCE_GAP_DAYS = 3;
export const MAX_DROP = { addresses: 0.02, streets: 0.02, routeNodes: 0.03 };
export const MAX_TILE_SWING = 0.25;

export type RegionSummary = { addresses: number; streets: number; neighbourhoods: number; places: number; routeNodes: number; tilesBytes: number; hoods: string[] };

export type ReleaseSummary = { tag: string; osmTimestamp: string; tilesBuild: string; tilesOsmTime: string; regions: Record<string, RegionSummary> };

export type Violation = { plate: string; metric: string; before: number; after: number; limit: string };

export type Comparison = {
  violations: Violation[];
  rows: { plate: string; addresses: number; streets: number; places: number; routeNodes: number; tilesPercent: number; newHoods: string[]; goneHoods: string[] }[];
  addedRegions: string[];
  removedRegions: string[];
};

const DAY = 86_400_000;

export const tagOf = (sources: Pick<Sources, 'osmTimestamp' | 'tilesBuild' | 'revision'>): string => `${sources.osmTimestamp.slice(0, 10).replace(/-/g, '')}.${sources.tilesBuild}${revisionSuffix(sources)}`;

export function freshnessProblems(sources: Sources, now: Date): string[] {
  const problems: string[] = [];
  const osm = Date.parse(sources.osmTimestamp);
  const tiles = Date.parse(sources.tilesOsmTime);
  if (!Number.isFinite(osm) || !Number.isFinite(tiles)) return ['kaynak tarihleri okunamadı'];
  const osmAge = (now.getTime() - osm) / DAY;
  const tilesAge = (now.getTime() - tiles) / DAY;
  const gap = Math.abs(osm - tiles) / DAY;
  if (osmAge > MAX_SOURCE_AGE_DAYS) problems.push(`OSM verisi ${osmAge.toFixed(1)} günlük (en çok ${MAX_SOURCE_AGE_DAYS})`);
  if (tilesAge > MAX_SOURCE_AGE_DAYS) problems.push(`karo verisi ${tilesAge.toFixed(1)} günlük (en çok ${MAX_SOURCE_AGE_DAYS})`);
  if (gap > MAX_SOURCE_GAP_DAYS) problems.push(`OSM ile karo arası ${gap.toFixed(1)} gün (en çok ${MAX_SOURCE_GAP_DAYS})`);
  return problems;
}

const drop = (before: number, after: number): number => (before === 0 ? 0 : (before - after) / before);

export function compareReleases(previous: ReleaseSummary, next: ReleaseSummary): Comparison {
  const violations: Violation[] = [];
  const rows: Comparison['rows'] = [];
  const plates = Object.keys(next.regions).sort();
  for (const plate of plates) {
    const after = next.regions[plate] as RegionSummary;
    const before = previous.regions[plate];
    if (!before) continue;
    for (const [metric, limit] of Object.entries(MAX_DROP) as [keyof typeof MAX_DROP, number][]) {
      if (drop(before[metric], after[metric]) > limit) violations.push({ plate, metric, before: before[metric], after: after[metric], limit: `en çok %${limit * 100} düşer` });
    }
    const swing = before.tilesBytes === 0 ? 0 : (after.tilesBytes - before.tilesBytes) / before.tilesBytes;
    if (Math.abs(swing) > MAX_TILE_SWING) violations.push({ plate, metric: 'tilesBytes', before: before.tilesBytes, after: after.tilesBytes, limit: `en çok %${MAX_TILE_SWING * 100} oynar` });
    const had = new Set(before.hoods);
    const has = new Set(after.hoods);
    rows.push({
      plate,
      addresses: after.addresses - before.addresses,
      streets: after.streets - before.streets,
      places: after.places - before.places,
      routeNodes: after.routeNodes - before.routeNodes,
      tilesPercent: Math.round(swing * 1000) / 10,
      newHoods: after.hoods.filter((h) => !had.has(h)),
      goneHoods: before.hoods.filter((h) => !has.has(h)),
    });
  }
  return { violations, rows, addedRegions: plates.filter((p) => !previous.regions[p]), removedRegions: Object.keys(previous.regions).filter((p) => !next.regions[p]).sort() };
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

export function renderChangeReport(previous: ReleaseSummary, next: ReleaseSummary, comparison: Comparison): string {
  const lines = [
    `# Yayın değişim raporu: ${previous.tag} → ${next.tag}`,
    '',
    `OSM: ${previous.osmTimestamp} → ${next.osmTimestamp}; karo: ${previous.tilesBuild} → ${next.tilesBuild}`,
    '',
    '| İl | Adres | Sokak | Yer | Yol düğümü | Karo boyutu | Yeni mahalle | Silinen mahalle |',
    '|---|---|---|---|---|---|---|---|',
    ...comparison.rows.map((r) => `| ${r.plate} | ${signed(r.addresses)} | ${signed(r.streets)} | ${signed(r.places)} | ${signed(r.routeNodes)} | %${signed(r.tilesPercent)} | ${r.newHoods.length} | ${r.goneHoods.length} |`),
    '',
  ];
  if (comparison.addedRegions.length > 0) lines.push(`Yeni iller: ${comparison.addedRegions.join(', ')}`, '');
  if (comparison.removedRegions.length > 0) lines.push(`Kalkan iller: ${comparison.removedRegions.join(', ')}`, '');
  const named = comparison.rows.filter((r) => r.newHoods.length > 0 || r.goneHoods.length > 0);
  if (named.length > 0) {
    lines.push('## Mahalle değişimi', '');
    for (const r of named) lines.push(`- ${r.plate}: yeni ${r.newHoods.slice(0, 12).join(', ') || '-'}; silinen ${r.goneHoods.slice(0, 12).join(', ') || '-'}`);
    lines.push('');
  }
  lines.push(comparison.violations.length === 0 ? 'Gerileme kapısı (K8.2): GEÇTİ' : 'Gerileme kapısı (K8.2): GEÇMEDİ', '');
  for (const v of comparison.violations) lines.push(`- ${v.plate} ${v.metric}: ${v.before} → ${v.after} (${v.limit})`);
  return lines.join('\n') + '\n';
}

export function summarizeRelease(workDir: string, packsDir: string, sources: Sources, regionIds: string[]): ReleaseSummary {
  const manifest = JSON.parse(readFileSync(join(packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; stats: { addresses: number; streets: number }; files: { kind: string; size: number; path: string }[] }[] };
  const regions: Record<string, RegionSummary> = {};
  for (const region of manifest.regions) {
    if (!regionIds.includes(region.id)) continue;
    const dir = join(workDir, 'packs', region.id);
    const read = (name: string): Record<string, number> => (existsSync(join(dir, name)) ? (JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, number>) : {});
    const address = region.files.find((f) => f.kind === 'address');
    const hoods = address ? hoodKeys(join(packsDir, address.path)) : [];
    regions[region.id] = {
      addresses: region.stats.addresses,
      streets: region.stats.streets,
      neighbourhoods: hoods.length,
      places: read('directory-stats.json').places ?? 0,
      routeNodes: read('route-stats.json').graphNodes ?? 0,
      tilesBytes: region.files.find((f) => f.kind === 'tiles')?.size ?? 0,
      hoods,
    };
  }
  return { tag: tagOf(sources), osmTimestamp: sources.osmTimestamp, tilesBuild: sources.tilesBuild, tilesOsmTime: sources.tilesOsmTime, regions };
}

function hoodKeys(file: string): string[] {
  const run = spawnSync('sqlite3', [file, 'SELECT key FROM neighbourhood ORDER BY key'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout.split('\n').filter((l) => l !== '') : [];
}

export function latestRelease(releasesDir: string, exclude?: string): ReleaseSummary | null {
  if (!existsSync(releasesDir)) return null;
  const tags = readdirSync(releasesDir).filter((t) => t !== exclude && existsSync(join(releasesDir, t, 'summary.json'))).sort();
  const last = tags[tags.length - 1];
  return last ? (JSON.parse(readFileSync(join(releasesDir, last, 'summary.json'), 'utf8')) as ReleaseSummary) : null;
}
