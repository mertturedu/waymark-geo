import type { Borders } from '../region/borders';
import type { ConnectionKind } from './ports';

export const NEAR_BORDER_M = 1000;

export type Detected = { region: string | null; nearBorder: string[] };
export type AutoDecision = { action: 'none' | 'suggest' | 'download' | 'consent'; regions: string[]; neighbours: string[]; bytes?: number };
export type Connection = ConnectionKind | 'unknown';
export const CELLULAR_ASK_MB = 50;

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

export type AutoInput = {
  location: unknown;
  borders: Borders;
  installed: string[];
  dismissed: string[];
  autoDownload: 'ask' | 'wifi' | 'always' | 'never';
  busy?: string[];
  connection?: Connection;
  bytesOf?: (id: string) => number;
  cellularAskBytes?: number;
};

export function decideAuto(input: AutoInput): AutoDecision {
  if (input.autoDownload === 'never' || !validPoint(input.location)) return NOTHING;
  const { region, nearBorder } = detectRegion(input.borders, input.location);
  const busy = input.busy ?? [];
  const open = (id: string): boolean => !input.installed.includes(id) && !input.dismissed.includes(id) && !busy.includes(id);
  const regions = region !== null && open(region) ? [region] : [];
  const neighbours = nearBorder.filter(open);
  if (regions.length === 0 && neighbours.length === 0) return NOTHING;
  if (regions.length > 0 && input.autoDownload !== 'ask') {
    const limit = input.cellularAskBytes ?? Number.POSITIVE_INFINITY;
    const metered = input.connection === 'cellular' || input.connection === 'unknown';
    if (input.autoDownload === 'always' && metered && Number.isFinite(limit) && input.bytesOf) {
      const bytes = regions.reduce((sum, id) => sum + (input.bytesOf as (id: string) => number)(id), 0);
      if (bytes > limit) return { action: 'consent', regions, neighbours, bytes };
    }
    return { action: 'download', regions, neighbours };
  }
  return { action: 'suggest', regions, neighbours };
}
