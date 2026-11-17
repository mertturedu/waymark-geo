import type { Borders } from '../../core/region/borders';
import type { ManifestRegion } from '../../core/region/manifest';

export type MissingState = 'none' | 'queued' | 'downloading' | 'paused' | 'verifying' | 'installed' | 'update-available' | 'error';

export const isMissing = (state: string): boolean => state !== 'installed' && state !== 'update-available';

export function missingPlates(regions: Pick<ManifestRegion, 'id'>[], stateOf: (id: string) => string): string[] {
  return regions.filter((region) => isMissing(stateOf(region.id))).map((region) => region.id);
}

export function missingAt(borders: Pick<Borders, 'provinceAt'>, regions: Pick<ManifestRegion, 'id'>[], stateOf: (id: string) => string, lng: number, lat: number): string | null {
  const plate = borders.provinceAt(lng, lat);
  if (!plate || !regions.some((region) => region.id === plate)) return null;
  return isMissing(stateOf(plate)) ? plate : null;
}

export function regionBytes(region: Pick<ManifestRegion, 'files'>, compressed = true): number {
  return region.files.reduce((sum, file) => sum + (compressed ? (file.encoded?.size ?? file.size) : file.size), 0);
}

export const removedPlates = (before: string[], after: string[]): string[] => before.filter((plate) => !after.includes(plate));

export const fadeLevel = (elapsedMs: number, durationMs: number): number => {
  const t = Math.min(1, Math.max(0, elapsedMs / Math.max(1, durationMs)));
  return 1 - t * t * (3 - 2 * t);
};
