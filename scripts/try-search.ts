import type { LngLat } from '../src/core/geo/cells';
import type { Search } from '../src/core/address/search';
import type { Place, Precision, ResolveResult, SearchOptions } from '../src/core/address/types';
import type { Lang } from '../src/core/text/types';
import type { TryCommands } from './try';

export type Flags = { text: string; near?: LngLat; city?: string; district?: string; limit?: number; language?: Lang; json: boolean; packs?: string };

const LANGS: Lang[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];
const PRECISION: Record<Precision, string> = { address: 'adres', interpolated: 'tahmini numara', street: 'sokak', neighbourhood: 'mahalle', district: 'ilçe', province: 'il', poi: 'yer' };
const SHOWN = 3;
const POINT_ERROR = 'boylam,enlem bekleniyor';

function parsePoint(text: string): LngLat | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function parseFlags(args: string[]): { flags: Flags } | { error: string } {
  const words: string[] = [];
  const flags: Flags = { text: '', json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (!['--near', '--city', '--district', '--limit', '--lang', '--packs'].includes(arg)) return { error: `bilinmeyen bayrak: ${arg}` };
    const value = args[i + 1];
    if (value === undefined) return { error: `${arg} bir değer ister` };
    i += 1;
    if (arg === '--near') {
      const point = parsePoint(value);
      if (!point) return { error: `geçersiz --near: ${value} (${POINT_ERROR})` };
      flags.near = point;
    } else if (arg === '--city') flags.city = value;
    else if (arg === '--district') flags.district = value;
    else if (arg === '--packs') flags.packs = value;
    else if (arg === '--limit') {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1) return { error: `geçersiz --limit: ${value}` };
      flags.limit = limit;
    } else {
      if (!LANGS.includes(value as Lang)) return { error: `geçersiz --lang: ${value} (${LANGS.join(', ')})` };
      flags.language = value as Lang;
    }
  }
  flags.text = words.join(' ').trim();
  if (flags.text === '') return { error: 'metin gerekli' };
  return { flags };
}

const line = (index: number, p: Place): string => `${index}. ${p.label}  [${PRECISION[p.precision]}, ${p.source}, güven ${p.confidence.toFixed(2)}]  ${p.coordinate[0].toFixed(6)},${p.coordinate[1].toFixed(6)}`;

export function formatPlaces(places: Place[]): string[] {
  return places.length === 0 ? ['Öneri yok'] : places.map((p, i) => line(i + 1, p));
}

export function formatResolve(result: ResolveResult): string[] {
  if (result.status === 'region_missing') return [`Durum: bölge paketi yok: ${result.regions.join(', ')}`];
  const state = { resolved: 'çözüldü', ambiguous: 'belirsiz', not_found: 'bulunamadı' }[result.status];
  const lines = [`Durum: ${state}`, ...result.candidates.slice(0, SHOWN).map((p, i) => line(i + 1, p))];
  if (result.candidates[0]?.precision === 'interpolated') lines.push('Not: tahmini nokta, kapı numarası haritada yok.');
  if (result.missing && result.missing.length > 0) lines.push(`Eksik komşu bölge paketi: ${result.missing.join(', ')}`);
  return lines;
}

export function formatReverse(place: Place | null): string[] {
  return place ? [line(1, place)] : ['Sonuç yok: nokta paketlerin dışında ya da ilgili paket yüklü değil'];
}

export async function runSearchCommand(kind: 'resolve' | 'search' | 'reverse', args: string[], search: Search): Promise<{ code: number; lines: string[] }> {
  const parsed = parseFlags(args);
  if ('error' in parsed) return { code: 2, lines: [parsed.error] };
  const { flags } = parsed;
  const options: SearchOptions = {};
  if (flags.near) options.near = flags.near;
  if (flags.city || flags.district) options.hints = { ...(flags.city ? { city: flags.city } : {}), ...(flags.district ? { district: flags.district } : {}) };
  if (flags.limit) options.limit = flags.limit;
  if (flags.language) options.language = flags.language;
  const show = (value: unknown, text: string[]): { code: number; lines: string[] } => ({ code: 0, lines: flags.json ? JSON.stringify(value, null, 2).split('\n') : text });
  if (kind === 'reverse') {
    const point = parsePoint(flags.text);
    if (!point) return { code: 2, lines: [`geçersiz nokta: ${flags.text} (${POINT_ERROR})`] };
    const found = await search.reverse(point, flags.language ? { language: flags.language } : undefined);
    return show(found, formatReverse(found));
  }
  if (kind === 'search') {
    const found = await search.autocomplete(flags.text, options);
    return show(found, formatPlaces(found));
  }
  const result = await search.resolve(flags.text, options);
  return show(result, formatResolve(result));
}

const packsOf = (args: string[]): string | undefined => {
  const at = args.indexOf('--packs');
  return at >= 0 ? args[at + 1] : undefined;
};

export function searchCommands(open: (packs?: string) => Promise<Search>): TryCommands {
  const make = (kind: 'resolve' | 'search' | 'reverse') => async (args: string[]): Promise<void> => {
    const early = parseFlags(args);
    const out = 'error' in early ? { code: 2, lines: [early.error] } : await runSearchCommand(kind, args, await open(packsOf(args)));
    for (const text of out.lines) console.log(text);
    if (out.code !== 0) process.exitCode = out.code;
  };
  return { resolve: make('resolve'), search: make('search'), reverse: make('reverse') };
}
