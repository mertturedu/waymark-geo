export const DEFAULT_PITCH = 0;
export const MAX_PITCH = 60;
export const FAR_JUMP_DEG = 0.3;
export const ZOOM_SLACK = 0.05;

export type MapView = { center: [number, number]; zoom: number; bearing?: number; pitch?: number };
export type JumpCamera = { jumpTo(view: MapView): void };

export const normalBearing = (bearing: number): number => (Number.isFinite(bearing) ? ((bearing % 360) + 360) % 360 : 0);

export const clampPitch = (pitch: number): number => (Number.isFinite(pitch) ? Math.min(MAX_PITCH, Math.max(0, pitch)) : 0);

export const safeView = <T extends object>(view: T & { bearing?: number; pitch?: number }): T => ({
  ...view,
  ...(view.bearing === undefined ? {} : { bearing: normalBearing(view.bearing) }),
  ...(view.pitch === undefined ? {} : { pitch: clampPitch(view.pitch) }),
});

export const tilted = <T extends object>(view: T & { pitch?: number; bearing?: number }): T & { pitch: number } => safeView({ ...view, pitch: view.pitch ?? DEFAULT_PITCH });

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function jumpTilted(camera: JumpCamera, view: MapView, read: () => Promise<{ center: [number, number]; zoom: number }>, settleMs = 300, wait: (ms: number) => Promise<void> = pause): Promise<void> {
  const target = safeView(view);
  const now = await read();
  const far = Math.abs(now.center[0] - target.center[0]) + Math.abs(now.center[1] - target.center[1]) > FAR_JUMP_DEG;
  if (far && (target.pitch ?? 0) > 0) {
    camera.jumpTo({ ...target, pitch: 0 });
    await wait(settleMs);
  }
  camera.jumpTo(target);
  await wait(settleMs);
  const landed = await read();
  if (Math.abs(landed.zoom - target.zoom) > ZOOM_SLACK) {
    camera.jumpTo(target);
    await wait(settleMs);
  }
}

export type Viewport = { width: number; height: number; padding?: number };
export type FitOptions = { maxZoom?: number; minZoom?: number; tileSize?: number };

export const FIT_MAX_ZOOM = 17;
export const FIT_MIN_ZOOM = 5;
const MAX_MERCATOR_LAT = 85.0511;

const mercatorY = (lat: number): number => {
  const clamped = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
};

export function fitBounds(box: readonly [number, number, number, number], viewport: Viewport, options: FitOptions = {}): { center: [number, number]; zoom: number } {
  const [west, south, east, north] = box;
  const tile = options.tileSize ?? 512;
  const padding = viewport.padding ?? 0;
  const width = Math.max(1, viewport.width - 2 * padding);
  const height = Math.max(1, viewport.height - 2 * padding);
  const spanX = Math.max(1e-9, (east - west) / 360);
  const spanY = Math.max(1e-9, Math.abs(mercatorY(south) - mercatorY(north)));
  const fit = Math.min(Math.log2(width / (tile * spanX)), Math.log2(height / (tile * spanY)));
  const zoom = Math.max(options.minZoom ?? FIT_MIN_ZOOM, Math.min(options.maxZoom ?? FIT_MAX_ZOOM, Number.isFinite(fit) ? fit : FIT_MAX_ZOOM));
  return { center: [(west + east) / 2, (south + north) / 2], zoom };
}
