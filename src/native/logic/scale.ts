import { t } from '../../core/i18n/messages';

export const SCALE_STEPS_M = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000, 2000000];
export const SCALE_MAX_PX = 110;
const EQUATOR_M = 40075016.686;
const TILE_PX = 512;

export function metersPerPixel(zoom: number, latitude: number): number {
  if (!Number.isFinite(zoom) || !Number.isFinite(latitude)) return 0;
  const lat = Math.min(85, Math.max(-85, latitude));
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** zoom);
}

export function scaleBar(zoom: number, latitude: number, maxPx: number = SCALE_MAX_PX): { meters: number; widthPx: number } | null {
  const perPixel = metersPerPixel(zoom, latitude);
  if (perPixel <= 0 || !(maxPx > 0)) return null;
  const limit = perPixel * maxPx;
  let meters: number | null = null;
  for (const step of SCALE_STEPS_M) if (step <= limit) meters = step;
  if (meters === null) return null;
  return { meters, widthPx: Math.round(meters / perPixel) };
}

export function scaleLabel(meters: number, lang: string): string {
  return meters >= 1000 ? `${meters / 1000} ${t(lang, 'unit.km')}` : `${meters} ${t(lang, 'unit.m')}`;
}
