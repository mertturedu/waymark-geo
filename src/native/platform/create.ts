import { Directory, Paths } from 'expo-file-system';
import { createGeo, type Geo, type GeoConfig } from '../../core/create-geo';
import { buildStyle, type MapFont, type MapStyle } from '../map/style';
import type { ResolvedMapLook } from '../map/theme';
import type { SqlDb } from '../../core/ports';
import type { ConnectivityPort, NetPort } from '../../core/packs/ports';
import type { Borders } from '../../core/region/borders';
import { createZstdDecode } from '../../core/packs/zstd';
import { createExpoConnectivity } from './connectivity';
import { createExpoFs } from './fs';
import { createExpoHash } from './hash';
import { createExpoLearnStore } from './learn-store';
import { createExpoNet } from './network';
import { createExpoOpener } from './sqlite';

export type GeoNativeConfig = GeoConfig & { zstd?: boolean; directory?: Directory; borders?: Borders; net?: NetPort; connectivity?: ConnectivityPort; wrapOpener?: (open: (path: string) => Promise<SqlDb>) => (path: string) => Promise<SqlDb>; tiles?: { url: string } };

export type MapStyleOptions = { theme: 'light' | 'dark'; language?: string; hoods?: { name: string; lng: number; lat: number }[]; hide?: string[]; look?: ResolvedMapLook; accent?: string; only?: string[]; font?: MapFont; traffic?: number };

export const MAX_STREAMED = 3;

export type StreamFocus = {
  set(points: [number, number][]): void;
  active(): string[];
  subscribe(listener: () => void): () => void;
};

export type GeoNative = Geo & { map: { style(options: MapStyleOptions): MapStyle; stream: StreamFocus } };

const inside = (box: [number, number, number, number], [lng, lat]: [number, number]): boolean => lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];

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
    ...(config.zstd === false ? {} : { decode: createZstdDecode() }),
    connectivity: config.connectivity ?? createExpoConnectivity(),
    opener: config.wrapOpener ? config.wrapOpener(createExpoOpener(root)) : createExpoOpener(root),
    learnStore: createExpoLearnStore(root),
    ...(config.borders ? { borders: config.borders } : {}),
  });
  let focus: [number, number][] = [];
  let focusKey = '';
  const listeners = new Set<() => void>();
  const streamed = (): { id: string; tilesPath: string; placesPath?: string; transitPath?: string; remote: [number, number, number, number] }[] => {
    if (!config.tiles || focus.length === 0) return [];
    const installed = new Set(geo.regions.installed());
    const regions = geo.regions.list();
    const found: ReturnType<typeof streamed> = [];
    for (const point of focus) {
      const region = regions.find((candidate) => !installed.has(candidate.id) && !found.some((item) => item.id === candidate.id) && inside(candidate.bbox, point) && candidate.files.some((file) => file.kind === 'tiles'));
      if (!region || found.length >= MAX_STREAMED) continue;
      const pathOf = (kind: string): string | undefined => region.files.find((file) => file.kind === kind)?.path;
      const placesPath = pathOf('places');
      const transitPath = pathOf('transit');
      found.push({ id: region.id, tilesPath: pathOf('tiles') as string, ...(placesPath ? { placesPath } : {}), ...(transitPath ? { transitPath } : {}), remote: region.bbox });
    }
    return found;
  };
  return {
    ...geo,
    map: {
      stream: {
        set: (points) => {
          const key = points.map(([lng, lat]) => `${lng.toFixed(2)},${lat.toFixed(2)}`).join(';');
          if (key === focusKey) return;
          focusKey = key;
          focus = points;
          listeners.forEach((listener) => listener());
        },
        active: () => streamed().map((region) => region.id),
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      style: ({ theme, language, hoods, hide, look, accent, only, font, traffic }) =>
        buildStyle({
          rootUrl: root.uri,
          baseDir: geo.regions.baseDir(),
          ...(config.tiles ? { tileUrl: config.tiles.url } : {}),
          regions: [
            ...geo.regions.installed().filter((id) => !only || only.includes(id)).flatMap((id) => {
              const tilesPath = geo.regions.installedFile(id, 'tiles');
              const placesPath = geo.regions.installedFile(id, 'places');
              return tilesPath ? [{ id, tilesPath, ...(placesPath ? { placesPath } : {}) }] : [];
            }),
            ...(only ? [] : streamed()),
          ],
          theme,
          lang: language ?? config.language ?? 'tr',
          ...(hoods ? { hoods } : {}),
          ...(hide && hide.length > 0 ? { hide } : {}),
          ...(look ? { look } : {}),
          ...(accent ? { accent } : {}),
          ...(font ? { font } : {}),
          ...(traffic !== undefined ? { traffic: { at: traffic } } : {}),
        }),
    },
  };
}
