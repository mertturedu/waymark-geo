import type { Borders } from '../region/borders';

export const NEAR_BORDER_M = 1000;

export type Detected = { region: string | null; nearBorder: string[] };
export type AutoDecision = { action: 'none' | 'suggest' | 'download'; regions: string[]; neighbours: string[] };

const NOTHING: AutoDecision = { action: 'none', regions: [], neighbours: [] };

function validPoint(point: unknown): point is [number, number] {
  if (!Array.isArray(point) || point.length < 2) return false;
  const [lng, lat] = point as unknown[];
  return typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
}

export function detectRegion(borders: Borders, point: unknown): Detected {
  if (!validPoint(point)) return { region: null, nearBorder: [] };
  return { region: borders.provinceAt(point[0], point[1]), nearBorder: borders.nearBorder(point[0], point[1], NEAR_BORDER_M) };
}

export function decideAuto(input: { location: unknown; borders: Borders; installed: string[]; dismissed: string[]; autoDownload: 'ask' | 'wifi' | 'always' | 'never' }): AutoDecision {
  if (input.autoDownload === 'never' || !validPoint(input.location)) return NOTHING;
  const { region, nearBorder } = detectRegion(input.borders, input.location);
  const open = (id: string): boolean => !input.installed.includes(id) && !input.dismissed.includes(id);
  const regions = region !== null && open(region) ? [region] : [];
  const neighbours = nearBorder.filter(open);
  if (regions.length === 0 && neighbours.length === 0) return NOTHING;
  if (regions.length > 0 && input.autoDownload !== 'ask') return { action: 'download', regions, neighbours };
  return { action: 'suggest', regions, neighbours };
}
