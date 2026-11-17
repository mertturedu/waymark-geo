export const NORTH_EASE_MS = 400;
export const BEARING_STEP_DEG = 0.5;

export type RotationView = { center: [number, number]; pitch?: number };

export const northTarget = (view: RotationView, duration: number = NORTH_EASE_MS) => ({
  center: view.center,
  bearing: 0,
  ...(view.pitch === undefined ? {} : { pitch: view.pitch }),
  duration,
});

export const bearingChanged = (shown: number, next: number): boolean => Math.abs(next - shown) >= BEARING_STEP_DEG || (next === 0 && shown !== 0);
