import { layers as protomapsLayers, namedFlavor } from '@protomaps/basemaps';

export type OfflineLayer = { id: string; type: string; source?: string; [key: string]: unknown };
export type OfflineStyle = {
  version: 8;
  sources: Record<string, Record<string, unknown>>;
  glyphs: string;
  sprite: string;
  layers: OfflineLayer[];
};
export type OfflineStyleOptions = {
  packsDir: string;
  pmtilesFile: string;
  theme: 'light' | 'dark';
  lang: string;
  fontNames?: 'original' | 'compact';
};

export function toFileUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('file://')) return pathOrUrl;
  return `file://${encodeURI(pathOrUrl)}`;
}

const rewriteFonts = (layers: OfflineLayer[], compact: boolean): OfflineLayer[] => {
  const shipped = JSON.stringify(layers).replace(/Noto Sans Devanagari Regular v1/g, 'Noto Sans Regular');
  return JSON.parse(compact ? shipped.replace(/Noto Sans (Regular|Medium|Italic)/g, 'NotoSans$1') : shipped) as OfflineLayer[];
};

export function buildOfflineStyle(options: OfflineStyleOptions): OfflineStyle {
  const root = toFileUrl(options.packsDir).replace(/\/$/, '');
  const compact = options.fontNames === 'compact';
  const generated = protomapsLayers('protomaps', namedFlavor(options.theme), { lang: options.lang }) as unknown as OfflineLayer[];
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${root}/${options.pmtilesFile}`,
        attribution: '© OpenStreetMap contributors',
        maxzoom: 15,
      },
    },
    glyphs: `${root}/${compact ? 'fonts-compact' : 'fonts'}/{fontstack}/{range}.pbf`,
    sprite: `${root}/sprites/v4/${options.theme}`,
    layers: rewriteFonts(generated, compact),
  };
}
