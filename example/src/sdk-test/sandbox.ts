import { Directory, Paths } from 'expo-file-system';
import { createGeoNative, type GeoNative, type GeoNativeConfig } from '../../../src/native';
import { PUBLIC_KEY } from '../sdk/server';
import type { TestContext } from '../device-test/types';

export const MAIN = 'main';

export const manifestUrlOf = (ctx: TestContext): string => `${ctx.packServerUrl}/manifest-v1.json`;

export function sandbox(name: string, wipe: boolean): Directory {
  const dir = new Directory(Paths.document, 'sdk-test', name);
  if (wipe && dir.exists) dir.delete();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function openGeo(ctx: TestContext, name: string, options: { wipe: boolean } & Partial<GeoNativeConfig>): Promise<{ geo: GeoNative; dir: Directory }> {
  const { wipe, ...rest } = options;
  const dir = sandbox(name, wipe);
  const geo = await createGeoNative({ manifestUrl: manifestUrlOf(ctx), publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [], directory: dir, ...rest });
  return { geo, dir };
}

export async function ensureIstanbul(ctx: TestContext, rest: Partial<GeoNativeConfig> = {}): Promise<{ geo: GeoNative; dir: Directory }> {
  const opened = await openGeo(ctx, MAIN, { wipe: false, ...rest });
  const status = opened.geo.regions.status('34');
  if (!status.installedParts.includes('address') || !status.installedParts.includes('buildings')) {
    const checked = await opened.geo.regions.checkUpdates();
    if (!checked.ok) throw new Error(`manifest alınamadı: ${checked.code}`);
    await opened.geo.regions.download('34', { parts: ['address', 'buildings'] });
  }
  return opened;
}
