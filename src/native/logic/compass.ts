import { normalBearing } from '../map/camera';

export const COMPASS_HIDE_DEG = 0.5;

export function signedBearing(bearing: number): number {
  const n = normalBearing(bearing);
  return n > 180 ? n - 360 : n;
}

export const compassVisible = (bearing: number): boolean => Math.abs(signedBearing(bearing)) > COMPASS_HIDE_DEG;

export const compassRotation = (bearing: number): number => -signedBearing(bearing);

export const northView = <T extends { bearing?: number; pitch?: number }>(view: T): T & { bearing: number } => ({ ...view, bearing: 0 });
