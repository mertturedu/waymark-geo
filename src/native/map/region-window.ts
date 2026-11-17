export type Bbox = [number, number, number, number];
export type WindowRegion = { id: string; bbox: Bbox };
export type ViewPoint = { center: [number, number]; zoom: number };
export type WindowOptions = { max?: number; marginKm?: number };

export const WINDOW_FROM_ZOOM = 9;
export const MAX_STYLED_REGIONS = 6;
export const WINDOW_MARGIN_KM = 30;

const HALF_SCREEN_PX = 700;
const EARTH_M = 40_075_016.686;
const M_PER_DEG_LAT = 111_320;

export function viewBox(view: ViewPoint, extraM = 0): Bbox {
  const [lng, lat] = view.center;
  const mpp = (EARTH_M * Math.cos((Math.min(85, Math.abs(lat)) * Math.PI) / 180)) / (512 * 2 ** view.zoom);
  const halfM = HALF_SCREEN_PX * mpp + extraM;
  const dLat = halfM / M_PER_DEG_LAT;
  const dLng = halfM / (M_PER_DEG_LAT * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

const touches = (a: Bbox, b: Bbox): boolean => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

const distanceSq = (view: ViewPoint, box: Bbox): number => {
  const dx = (box[0] + box[2]) / 2 - view.center[0];
  const dy = (box[1] + box[3]) / 2 - view.center[1];
  return dx * dx + dy * dy;
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function regionsForView(view: ViewPoint | undefined, regions: WindowRegion[], current: string[] | null, options: WindowOptions = {}): string[] {
  const max = options.max ?? MAX_STYLED_REGIONS;
  const known = new Set(regions.map((region) => region.id));
  const ids = [...known].sort(byId);
  if (!view || !Number.isFinite(view.zoom) || !Number.isFinite(view.center[0]) || !Number.isFinite(view.center[1])) return ids;
  const stillThere = current !== null && current.every((id) => known.has(id));
  const nearest = (candidates: WindowRegion[], count: number): WindowRegion[] => [...candidates].sort((a, b) => distanceSq(view, a.bbox) - distanceSq(view, b.bbox) || byId(a.id, b.id)).slice(0, count);
  if (view.zoom < WINDOW_FROM_ZOOM) return stillThere ? (current as string[]) : nearest(regions, max).map((region) => region.id).sort(byId);
  const covering = regions.filter((region) => touches(viewBox(view), region.bbox));
  if (stillThere && covering.every((region) => (current as string[]).includes(region.id))) return current as string[];
  const coveringIds = new Set(covering.map((region) => region.id));
  const margin = regions.filter((region) => !coveringIds.has(region.id) && touches(viewBox(view, (options.marginKm ?? WINDOW_MARGIN_KM) * 1000), region.bbox));
  const room = Math.max(0, max - covering.length);
  return [...covering, ...nearest(margin, room)].map((region) => region.id).sort(byId);
}
