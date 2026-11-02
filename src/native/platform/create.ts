import { Directory, Paths } from 'expo-file-system';
import { createGeo, type Geo, type GeoConfig } from '../../core/create-geo';
import { buildStyle, type MapStyle } from '../map/style';
import type { ResolvedMapLook } from '../map/theme';
import type { SqlDb } from '../../core/ports';
import type { NetPort } from '../../core/packs/ports';
import type { Borders } from '../../core/region/borders';
import { createExpoConnectivity } from './connectivity';
import { createExpoFs } from './fs';
import { createExpoHash } from './hash';
import { createExpoLearnStore } from './learn-store';
import { createExpoNet } from './network';
import { createExpoOpener } from './sqlite';

export type GeoNativeConfig = GeoConfig & { directory?: Directory; borders?: Borders; net?: NetPort; wrapOpener?: (open: (path: string) => Promise<SqlDb>) => (path: string) => Promise<SqlDb> };

export type GeoNative = Geo & { map: { style(options: { theme: 'light' | 'dark'; language?: string; hoods?: { name: string; lng: number; lat: number }[]; hide?: string[]; look?: ResolvedMapLook; accent?: string }): MapStyle } };

const clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

export async function createGeoNative(config: GeoNativeConfig): Promise<GeoNative> {
  const root = config.directory ?? new Directory(Paths.document, 'yuksi-geo');
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  const fs = createExpoFs(root);
  const geo = await createGeo(config, {
    fs,
    net: config.net ?? createExpoNet(),
    hash: createExpoHash(fs),
    clock,
    connectivity: createExpoConnectivity(),
    opener: config.wrapOpener ? config.wrapOpener(createExpoOpener(root)) : createExpoOpener(root),
    learnStore: createExpoLearnStore(root),
    ...(config.borders ? { borders: config.borders } : {}),
  });
  return {
    ...geo,
    map: {
      style: ({ theme, language, hoods, hide, look, accent }) =>
        buildStyle({
          rootUrl: root.uri,
          baseDir: geo.regions.baseDir(),
          regions: geo.regions.installed().flatMap((id) => {
            const tilesPath = geo.regions.installedFile(id, 'tiles');
            const placesPath = geo.regions.installedFile(id, 'places');
            return tilesPath ? [{ id, tilesPath, ...(placesPath ? { placesPath } : {}) }] : [];
          }),
          theme,
          lang: language ?? config.language ?? 'tr',
          ...(hoods ? { hoods } : {}),
          ...(hide && hide.length > 0 ? { hide } : {}),
          ...(look ? { look } : {}),
          ...(accent ? { accent } : {}),
        }),
    },
  };
}
