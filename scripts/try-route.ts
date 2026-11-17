import type { LngLat } from '../src/core/geo/cells';
import type { Search } from '../src/core/address/search';
import type { SearchOptions } from '../src/core/address/types';
import type { RouteResult, Router } from '../src/core/route/router';
import type { TryCommands } from './try';

export type RouteFlags = { from: string; to: string; city?: string; district?: string; json: boolean; packs?: string; vehicle?: 'car' | 'motorcycle' };

const STOP_NAME = ['başlangıç', 'varış'];

function parsePoint(text: string): LngLat | null {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function parseRouteFlags(args: string[]): { flags: RouteFlags } | { error: string } {
  const words: string[] = [];
  const extra: Partial<RouteFlags> = {};
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (!['--city', '--district', '--packs', '--vehicle'].includes(arg)) return { error: `bilinmeyen bayrak: ${arg}` };
    const value = args[i + 1];
    if (value === undefined) return { error: `${arg} bir değer ister` };
    i += 1;
    if (arg === '--city') extra.city = value;
    else if (arg === '--district') extra.district = value;
    else if (arg === '--vehicle') {
      if (value !== 'car' && value !== 'motorcycle') return { error: `geçersiz --vehicle: ${value} (car, motorcycle)` };
      extra.vehicle = value;
    } else extra.packs = value;
  }
  if (words.length !== 2) return { error: 'iki nokta gerekli: başlangıç ve varış' };
  return { flags: { from: words[0] as string, to: words[1] as string, ...extra, json } };
}

export function formatRoute(result: RouteResult): string[] {
  if (!result.ok) {
    const who = result.stop === undefined ? 'başlangıç' : (STOP_NAME[result.stop] as string);
    const text: Record<typeof result.code, string> = {
      START_OUTSIDE_REGION: 'başlangıç hiçbir yüklü rota paketinin kapsamında değil',
      PACK_DAMAGED: 'rota paketi okunamadı',
      no_road: `${who} için 500 m içinde sürülebilir yol yok`,
      outside_region: `${who} rota paketinin kapsamı dışında`,
      disconnected: 'varışa bu yoldan ulaşılamıyor',
    };
    return [`Hata: ${text[result.code]}`];
  }
  const minutes = Math.max(1, Math.round(result.durationS / 60));
  const lines = [`Rota: ${(result.distanceM / 1000).toFixed(1)} km, ${minutes} dk${result.approximate ? ' (yaklaşık, motosiklet)' : ''}  [bölge ${result.region}]`];
  for (const warning of result.warnings) lines.push(`Uyarı: ${STOP_NAME[warning.stop]} noktası yola uzak (150 m üstü) bir yere oturtuldu`);
  return lines;
}

async function place(text: string, label: string, search: Search, options: SearchOptions): Promise<{ at: LngLat; line: string } | { fail: string }> {
  const point = parsePoint(text);
  if (point) return { at: point, line: `${label}: ${point[0].toFixed(6)},${point[1].toFixed(6)}` };
  const found = await search.resolve(text, options);
  if (found.status === 'region_missing') return { fail: `${label} için bölge paketi yok: ${found.regions.join(', ')}` };
  const first = found.status === 'not_found' ? undefined : found.candidates[0];
  if (!first) return { fail: `${label} bulunamadı: ${text}` };
  const note = found.status === 'ambiguous' ? ' (belirsiz, ilk aday)' : '';
  return { at: first.coordinate, line: `${label}: ${first.label}${note}  ${first.coordinate[0].toFixed(6)},${first.coordinate[1].toFixed(6)}` };
}

export async function runRouteCommand(args: string[], search: Search, router: Router): Promise<{ code: number; lines: string[] }> {
  const parsed = parseRouteFlags(args);
  if ('error' in parsed) return { code: 2, lines: [parsed.error] };
  const { flags } = parsed;
  const options: SearchOptions = flags.city || flags.district ? { hints: { ...(flags.city ? { city: flags.city } : {}), ...(flags.district ? { district: flags.district } : {}) } } : {};
  const from = await place(flags.from, 'Başlangıç', search, options);
  if ('fail' in from) return { code: 1, lines: [from.fail] };
  const to = await place(flags.to, 'Varış', search, options);
  if ('fail' in to) return { code: 1, lines: [to.fail] };
  const result = await router.route(from.at, to.at, flags.vehicle ? { vehicle: flags.vehicle } : undefined);
  if (flags.json) return { code: result.ok ? 0 : 1, lines: JSON.stringify(result, null, 2).split('\n') };
  return { code: result.ok ? 0 : 1, lines: [from.line, to.line, ...formatRoute(result)] };
}

const packsOf = (args: string[]): string | undefined => {
  const at = args.indexOf('--packs');
  return at >= 0 ? args[at + 1] : undefined;
};

export function routeCommands(open: (packs?: string) => Promise<{ search: Search; router: Router }>): TryCommands {
  return {
    async route(args) {
      const early = parseRouteFlags(args);
      const out = 'error' in early ? { code: 2, lines: [early.error] } : await (async () => { const { search, router } = await open(packsOf(args)); return runRouteCommand(args, search, router); })();
      for (const text of out.lines) console.log(text);
      if (out.code !== 0) process.exitCode = out.code;
    },
  };
}
