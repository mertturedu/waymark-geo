import chains from './chains.json';

export type IconGroup = 'health' | 'pharmacy' | 'safety' | 'money' | 'fuel' | 'worship' | 'lodging' | 'market' | 'public' | 'food' | 'shop' | 'cargo' | 'landmark';
export type Emphasis = 'strong' | 'normal' | 'quiet';
export type BrandMode = 'ladder' | 'badge' | 'category' | 'logo' | 'hidden';

export type GroupLook = { color?: string; emphasis?: Emphasis; visible?: boolean };
export type ChainLook = { fill?: string; ink?: string; text?: string; visible?: boolean };
export type MapLook = {
  icons?: { style?: 'color' | 'muted' | 'mono'; scale?: number; groups?: Partial<Record<IconGroup, GroupLook>> };
  brands?: { mode?: BrandMode; ladder?: { badgeFrom?: number; logoFrom?: number }; shape?: 'circle' | 'rounded'; chains?: Record<string, ChainLook> };
};
export type ThemeColors = { accent?: string; bg?: string; fg?: string; mute?: string; line?: string; danger?: string; success?: string; radius?: number; font?: string };
export type ThemeLayer = { colors?: ThemeColors; map?: MapLook };
export type GeoThemeInput = ThemeLayer & { version?: 1; light?: ThemeLayer; dark?: ThemeLayer };

export type ResolvedColors = Required<Omit<ThemeColors, 'font'>> & { font: string | null };
export type ResolvedGroup = { color: string; emphasis: Emphasis; visible: boolean };
export type ResolvedChain = { group: string; fill: string; ink: string; text: string; logo: string; visible: boolean };
export type ResolvedMapLook = {
  icons: { style: 'color' | 'muted' | 'mono'; scale: number; groups: Record<IconGroup, ResolvedGroup> };
  brands: { mode: BrandMode; badgeFrom: number; logoFrom: number; shape: 'circle' | 'rounded'; chains: Record<string, ResolvedChain> };
};
export type ResolvedTheme = { colors: ResolvedColors; map: ResolvedMapLook };
export type GeoTheme = { version: 1; light: ResolvedTheme; dark: ResolvedTheme; input: GeoThemeInput; warnings: string[] };

export const ICON_GROUPS: IconGroup[] = ['health', 'pharmacy', 'safety', 'money', 'fuel', 'worship', 'lodging', 'market', 'public', 'food', 'shop', 'cargo', 'landmark'];

const GROUP_COLORS: Record<IconGroup, string> = {
  health: '#D46A66',
  pharmacy: '#4BA477',
  safety: '#5B84D2',
  money: '#3F9281',
  fuel: '#DF9733',
  worship: '#3C9E9F',
  lodging: '#9579C1',
  market: '#AC8257',
  public: '#808C99',
  food: '#E5A642',
  shop: '#C07A9D',
  cargo: '#E8590C',
  landmark: '#4B3F8F',
};

const GROUP_EMPHASIS: Partial<Record<IconGroup, Emphasis>> = { health: 'strong', pharmacy: 'strong', fuel: 'strong', safety: 'strong', food: 'quiet', shop: 'quiet' };

const COLORS: Record<'light' | 'dark', ResolvedColors> = {
  light: { accent: '#FF5B04', bg: '#FFFFFF', fg: '#16161A', mute: '#6B6B73', line: '#E3E3E8', danger: '#DD3333', success: '#2E9E5B', radius: 16, font: null },
  dark: { accent: '#FF7A2F', bg: '#1B1B1D', fg: '#F2F2F2', mute: '#9A9AA0', line: '#333333', danger: '#FF5A5A', success: '#4CC07F', radius: 16, font: null },
};

const MUTED_TARGET = { light: '#9A9AA2', dark: '#7C7C86' };
const LADDER = { badgeFrom: 16, logoFrom: 17.5 };
const SCALE_RANGE: [number, number] = [0.5, 2];
const ZOOM_RANGE: [number, number] = [10, 22];
const MIN_INK_CONTRAST = 3;

const HEX = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join('') : match[1]!;
  return `#${digits.toUpperCase()}`;
}

const channels = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export function mix(a: string, b: string, amount: number): string {
  const x = channels(a);
  const y = channels(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * amount).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const luminance = (hex: string): number => {
  const [r, g, b] = channels(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

export function readableInk(fill: string, ink: string): string {
  if (contrast(fill, ink) >= MIN_INK_CONTRAST) return ink;
  return contrast(fill, '#FFFFFF') >= contrast(fill, '#151515') ? '#FFFFFF' : '#151515';
}

export function monogram(text: string): string {
  const clean = text.trim();
  if ([...clean].length <= 3) return clean;
  return [...clean][0] ?? '';
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function pickColor(value: unknown, fallback: string, path: string, warnings: string[]): string {
  if (value === undefined) return fallback;
  const color = parseColor(value);
  if (color) return color;
  warnings.push(`${path}: ${String(value)}`);
  return fallback;
}

function pickNumber(value: unknown, fallback: number, range: [number, number], path: string, warnings: string[]): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    warnings.push(`${path}: ${String(value)}`);
    return fallback;
  }
  const clamped = Math.min(range[1], Math.max(range[0], value));
  if (clamped !== value) warnings.push(`${path}: ${value}`);
  return clamped;
}

function pickOne<T extends string>(value: unknown, allowed: readonly T[], fallback: T, path: string, warnings: string[]): T {
  if (value === undefined) return fallback;
  if (allowed.includes(value as T)) return value as T;
  warnings.push(`${path}: ${String(value)}`);
  return fallback;
}

function resolveColors(base: ResolvedColors, layers: (ThemeColors | undefined)[], warnings: string[]): ResolvedColors {
  const out = { ...base };
  for (const layer of layers) {
    if (!isObject(layer)) continue;
    for (const key of ['accent', 'bg', 'fg', 'mute', 'line', 'danger', 'success'] as const) out[key] = pickColor(layer[key], out[key], `colors.${key}`, warnings);
    if (layer.radius !== undefined) out.radius = pickNumber(layer.radius, out.radius, [0, 40], 'colors.radius', warnings);
    if (layer.font !== undefined) out.font = typeof layer.font === 'string' && layer.font.trim() !== '' ? layer.font : out.font;
  }
  return out;
}

function defaultLook(): ResolvedMapLook {
  const groups = Object.fromEntries(ICON_GROUPS.map((group) => [group, { color: GROUP_COLORS[group], emphasis: GROUP_EMPHASIS[group] ?? 'normal', visible: true }])) as Record<IconGroup, ResolvedGroup>;
  const chainLooks = Object.fromEntries(
    chains.map((chain) => {
      const fill = parseColor(chain.fill) ?? '#808080';
      return [chain.id, { group: chain.group, fill, ink: readableInk(fill, parseColor(chain.ink) ?? '#FFFFFF'), text: monogram(chain.text), logo: chain.text, visible: true }];
    }),
  );
  return { icons: { style: 'color', scale: 1, groups }, brands: { mode: 'ladder', badgeFrom: LADDER.badgeFrom, logoFrom: LADDER.logoFrom, shape: 'circle', chains: chainLooks } };
}

export function resolveMapLook(base: ResolvedMapLook, look: MapLook | undefined, warnings: string[] = []): ResolvedMapLook {
  if (!isObject(look)) return base;
  const icons = { ...base.icons, groups: { ...base.icons.groups } };
  const brands = { ...base.brands, chains: { ...base.brands.chains } };
  if (isObject(look.icons)) {
    icons.style = pickOne(look.icons.style, ['color', 'muted', 'mono'] as const, icons.style, 'map.icons.style', warnings);
    icons.scale = pickNumber(look.icons.scale, icons.scale, SCALE_RANGE, 'map.icons.scale', warnings);
    if (isObject(look.icons.groups)) {
      for (const [name, value] of Object.entries(look.icons.groups)) {
        if (!ICON_GROUPS.includes(name as IconGroup)) {
          warnings.push(`map.icons.groups.${name}`);
          continue;
        }
        if (!isObject(value)) continue;
        const current = icons.groups[name as IconGroup];
        icons.groups[name as IconGroup] = {
          color: pickColor(value.color, current.color, `map.icons.groups.${name}.color`, warnings),
          emphasis: pickOne(value.emphasis, ['strong', 'normal', 'quiet'] as const, current.emphasis, `map.icons.groups.${name}.emphasis`, warnings),
          visible: typeof value.visible === 'boolean' ? value.visible : current.visible,
        };
      }
    }
  }
  if (isObject(look.brands)) {
    brands.mode = pickOne(look.brands.mode, ['ladder', 'badge', 'category', 'logo', 'hidden'] as const, brands.mode, 'map.brands.mode', warnings);
    brands.shape = pickOne(look.brands.shape, ['circle', 'rounded'] as const, brands.shape, 'map.brands.shape', warnings);
    if (isObject(look.brands.ladder)) {
      brands.badgeFrom = pickNumber(look.brands.ladder.badgeFrom, brands.badgeFrom, ZOOM_RANGE, 'map.brands.ladder.badgeFrom', warnings);
      brands.logoFrom = pickNumber(look.brands.ladder.logoFrom, brands.logoFrom, ZOOM_RANGE, 'map.brands.ladder.logoFrom', warnings);
      if (brands.logoFrom < brands.badgeFrom) {
        warnings.push('map.brands.ladder: logoFrom < badgeFrom');
        brands.logoFrom = brands.badgeFrom;
      }
    }
    if (isObject(look.brands.chains)) {
      for (const [id, value] of Object.entries(look.brands.chains)) {
        const current = brands.chains[id];
        if (!current) {
          warnings.push(`map.brands.chains.${id}`);
          continue;
        }
        if (!isObject(value)) continue;
        const fill = pickColor(value.fill, current.fill, `map.brands.chains.${id}.fill`, warnings);
        const ink = pickColor(value.ink, current.ink, `map.brands.chains.${id}.ink`, warnings);
        const text = typeof value.text === 'string' && value.text.trim() !== '' ? monogram(value.text) : current.text;
        brands.chains[id] = { ...current, fill, ink: readableInk(fill, ink), text, visible: typeof value.visible === 'boolean' ? value.visible : current.visible };
      }
    }
  }
  return { icons, brands };
}

function resolveSide(input: GeoThemeInput, side: 'light' | 'dark', warnings: string[]): ResolvedTheme {
  const own = isObject(input[side]) ? input[side] : undefined;
  const colors = resolveColors(COLORS[side], [input.colors, own?.colors], warnings);
  const map = resolveMapLook(resolveMapLook(defaultLook(), input.map, warnings), own?.map, warnings);
  return { colors, map };
}

export function createGeoTheme(input: GeoThemeInput = {}): GeoTheme {
  const warnings: string[] = [];
  const safe = isObject(input) ? input : {};
  if (safe.version !== undefined && safe.version !== 1) warnings.push(`version: ${String(safe.version)}`);
  const light = resolveSide(safe, 'light', warnings);
  const dark = resolveSide(safe, 'dark', warnings);
  return { version: 1, light, dark, input: safe, warnings: [...new Set(warnings)] };
}

export const DEFAULT_THEME: GeoTheme = createGeoTheme();

export function iconColor(look: ResolvedMapLook, group: IconGroup, theme: 'light' | 'dark', accent: string): string {
  const color = look.icons.groups[group].color;
  if (look.icons.style === 'mono') return accent;
  if (look.icons.style === 'muted') return mix(color, MUTED_TARGET[theme], 0.7);
  return color;
}

export function hiddenTokens(look: ResolvedMapLook): string[] {
  const groups = ICON_GROUPS.filter((group) => group !== 'landmark' && !look.icons.groups[group].visible).map((group) => `group:${group}`);
  const landmark = look.icons.groups.landmark.visible ? [] : ['landmarks'];
  const brands = look.brands.mode === 'hidden' ? ['brands'] : [];
  const chainIds = Object.entries(look.brands.chains)
    .filter(([, chain]) => !chain.visible)
    .map(([id]) => `chain:${id}`);
  return [...groups, ...landmark, ...brands, ...chainIds];
}
