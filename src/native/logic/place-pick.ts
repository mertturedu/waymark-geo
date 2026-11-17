export const PICK_RADIUS_PX = 24;
const SAME_PX = 0.5;

export type Pickable<T> = { x: number; y: number; tier: number; item: T };

export function pickPlace<T>(candidates: readonly Pickable<T>[], tap: { x: number; y: number }, maxPx: number = PICK_RADIUS_PX): T | null {
  let best: { gap: number; tier: number; item: T } | null = null;
  for (const c of candidates) {
    const gap = Math.hypot(c.x - tap.x, c.y - tap.y);
    if (!Number.isFinite(gap) || gap > maxPx) continue;
    if (best === null || gap < best.gap - SAME_PX || (Math.abs(gap - best.gap) <= SAME_PX && c.tier < best.tier)) best = { gap, tier: c.tier, item: c.item };
  }
  return best ? best.item : null;
}
