import golden from '../../../../fixtures/address-golden/34.json';
import type { Place } from '../../../../src/core/address/types';
import type { GeoNative } from '../../../../src/native';
import type { TestContext } from '../../device-test/types';
import { ensureIstanbul } from '../sandbox';

export const HINT = { hints: { city: 'İstanbul' } };

export type GoldenQuery = { id: string; text: string; category: string; expect: { number?: string; streetName?: string } };

export const GOLDEN = (golden as { queries: GoldenQuery[] }).queries;
export const FULL = GOLDEN.filter((q) => q.category === 'full');

export const KADIKOY: [number, number] = [29.0275, 40.9878];
export const BESIKTAS: [number, number] = [29.0097, 41.0422];

export async function firstDoor(geo: GeoNative): Promise<{ text: string; place: Place } | null> {
  for (const q of FULL) {
    const found = await geo.search.resolve(q.text, HINT);
    if (found.status === 'resolved' && found.best.precision === 'address' && found.best.components.houseNumber) return { text: q.text, place: found.best };
  }
  return null;
}

export async function ensureRoute(ctx: TestContext): Promise<{ geo: GeoNative; downloaded: boolean }> {
  const { geo } = await ensureIstanbul(ctx);
  if (geo.regions.status('34').installedParts.includes('route')) return { geo, downloaded: false };
  const checked = await geo.regions.checkUpdates();
  if (!checked.ok) throw new Error(`manifest alınamadı: ${checked.code}`);
  await geo.regions.download('34', { parts: ['route'] });
  return { geo, downloaded: true };
}

export const metres = (a: [number, number], b: [number, number]): number => {
  const dx = (a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
};

export const percentile = (values: number[], share: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * share))] ?? 0;
