import type { Search } from '../../src/core/address/search';
import type { Place, ResolveResult } from '../../src/core/address/types';
import type { RouteResult, Router } from '../../src/core/route/router';
import { formatRoute, parseRouteFlags, runRouteCommand } from '../../scripts/try-route';

const place = (label: string, at: [number, number]): Place => ({ id: 'x', label, components: {}, coordinate: at, precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34' });

const search = (answers: Record<string, ResolveResult>): Search =>
  ({ resolve: async (text: string) => answers[text] ?? { status: 'not_found', candidates: [] }, lookup: async () => null, admin: async () => null, validate: async () => { throw new Error('unused'); }, autocomplete: async () => [], reverse: async () => null, nearby: async () => [], invalidate: () => undefined, hoods: async () => [], coverage: async () => null, warm: async () => true, geometry: async () => null, arrival: async (p: Place) => ({ door: p.coordinate }) }) as Search;

const ok: RouteResult = { ok: true, region: '34', distanceM: 12_340, durationS: 1500, approximate: false, geometry: [[29, 41], [29.1, 41.1]], from: [29, 41], to: [29.1, 41.1], warnings: [] };
const router = (result: RouteResult): Router => ({ route: async () => result, matrix: async () => ({ ok: false, code: 'START_OUTSIDE_REGION' }), invalidate: () => undefined });

describe('parseRouteFlags', () => {
  it('reads two operands and the flags', () => {
    expect(parseRouteFlags(['Kadıköy Moda', '29.0,41.0', '--city', 'İstanbul', '--json', '--vehicle', 'motorcycle'])).toEqual({ flags: { from: 'Kadıköy Moda', to: '29.0,41.0', city: 'İstanbul', json: true, vehicle: 'motorcycle' } });
  });

  it('says what is wrong', () => {
    expect(parseRouteFlags(['a'])).toEqual({ error: 'iki nokta gerekli: başlangıç ve varış' });
    expect(parseRouteFlags(['a', 'b', 'c'])).toEqual({ error: 'iki nokta gerekli: başlangıç ve varış' });
    expect(parseRouteFlags(['a', 'b', '--x'])).toEqual({ error: 'bilinmeyen bayrak: --x' });
    expect(parseRouteFlags(['a', 'b', '--city'])).toEqual({ error: '--city bir değer ister' });
    expect(parseRouteFlags(['a', 'b', '--vehicle', 'boat'])).toEqual({ error: 'geçersiz --vehicle: boat (car, motorcycle)' });
  });
});

describe('formatRoute', () => {
  it('shows distance in kilometres and time in minutes', () => {
    expect(formatRoute(ok)).toEqual(['Rota: 12.3 km, 25 dk  [bölge 34]']);
    expect(formatRoute({ ...ok, distanceM: 800, durationS: 50 })).toEqual(['Rota: 0.8 km, 1 dk  [bölge 34]']);
    expect(formatRoute({ ...ok, approximate: true })).toEqual(['Rota: 12.3 km, 25 dk (yaklaşık, motosiklet)  [bölge 34]']);
  });

  it('names the warnings and the failures', () => {
    expect(formatRoute({ ...ok, warnings: [{ stop: 1, code: 'far_snap' }] })[1]).toBe('Uyarı: varış noktası yola uzak (150 m üstü) bir yere oturtuldu');
    expect(formatRoute({ ok: false, code: 'START_OUTSIDE_REGION' })).toEqual(['Hata: başlangıç hiçbir yüklü rota paketinin kapsamında değil']);
    expect(formatRoute({ ok: false, code: 'no_road', stop: 1 })).toEqual(['Hata: varış için 500 m içinde sürülebilir yol yok']);
    expect(formatRoute({ ok: false, code: 'outside_region', stop: 1 })).toEqual(['Hata: varış rota paketinin kapsamı dışında']);
    expect(formatRoute({ ok: false, code: 'disconnected', stop: 1 })).toEqual(['Hata: varışa bu yoldan ulaşılamıyor']);
    expect(formatRoute({ ok: false, code: 'PACK_DAMAGED' })).toEqual(['Hata: rota paketi okunamadı']);
  });
});

describe('runRouteCommand', () => {
  it('takes coordinates as they are and addresses through the search', async () => {
    const resolved: ResolveResult = { status: 'resolved', best: place('Moda', [29.02, 40.98]), candidates: [place('Moda', [29.02, 40.98])] };
    const out = await runRouteCommand(['Moda', '29.1,41.1'], search({ Moda: resolved }), router(ok));
    expect(out.code).toBe(0);
    expect(out.lines).toEqual(['Başlangıç: Moda  29.020000,40.980000', 'Varış: 29.100000,41.100000', 'Rota: 12.3 km, 25 dk  [bölge 34]']);
  });

  it('uses the first candidate of an ambiguous address and says so', async () => {
    const many: ResolveResult = { status: 'ambiguous', candidates: [place('Moda A', [29, 41]), place('Moda B', [29.5, 41.5])] };
    const out = await runRouteCommand(['Moda', '29.1,41.1'], search({ Moda: many }), router(ok));
    expect(out.lines[0]).toBe('Başlangıç: Moda A (belirsiz, ilk aday)  29.000000,41.000000');
  });

  it('stops with a message when an address cannot be found', async () => {
    const out = await runRouteCommand(['Yok', '29.1,41.1'], search({}), router(ok));
    expect(out).toEqual({ code: 1, lines: ['Başlangıç bulunamadı: Yok'] });
    const missing = await runRouteCommand(['29,41', 'Moda'], search({ Moda: { status: 'region_missing', regions: ['34'] } }), router(ok));
    expect(missing).toEqual({ code: 1, lines: ['Varış için bölge paketi yok: 34'] });
  });

  it('prints the whole result for --json and the exit code of a failed route', async () => {
    const json = await runRouteCommand(['29,41', '29.1,41.1', '--json'], search({}), router(ok));
    expect(JSON.parse(json.lines.join('\n'))).toMatchObject({ ok: true, region: '34' });
    const failed = await runRouteCommand(['29,41', '29.1,41.1'], search({}), router({ ok: false, code: 'no_road', stop: 1 }));
    expect(failed.code).toBe(1);
  });

  it('returns usage errors with code 2', async () => {
    expect(await runRouteCommand(['a'], search({}), router(ok))).toEqual({ code: 2, lines: ['iki nokta gerekli: başlangıç ve varış'] });
  });
});
