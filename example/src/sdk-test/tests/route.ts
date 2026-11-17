import type { DeviceTest } from '../../device-test/types';
import { BESIKTAS, ensureRoute, KADIKOY, metres } from './helpers';

const ROUTE_LIMIT_MB = 35;
const SEA: [number, number] = [29.0, 40.85];
const ANKARA: [number, number] = [32.85, 39.92];
const BUYUKADA: [number, number] = [29.1233, 40.8736];

const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });

export const sdkRouteInstall = test('sdk.route-install', 'Rota paketi: İstanbul indirme, boyut ve kurulu listesi', async (ctx) => {
  const started = Date.now();
  const { geo, downloaded } = await ensureRoute(ctx);
  try {
    const size = geo.regions.list().find((r) => r.id === '34')?.files.find((f) => f.kind === 'route')?.size ?? 0;
    if (size === 0) return { outcome: 'fail', note: 'manifestte İstanbul rota paketi yok' };
    if (size > ROUTE_LIMIT_MB * 1_000_000) return { outcome: 'fail', note: `rota paketi ${(size / 1e6).toFixed(1)} MB, sınır ${ROUTE_LIMIT_MB}` };
    const installed = await geo.route.installed();
    if (!installed.includes('34')) return { outcome: 'fail', note: `kurulu rota listesi ${JSON.stringify(installed)}` };
    return { outcome: 'pass', value: (size / 1e6).toFixed(1), unit: 'MB', threshold: `≤ ${ROUTE_LIMIT_MB} MB`, note: downloaded ? `indirme ${((Date.now() - started) / 1000).toFixed(1)} sn` : 'önceden kuruluydu' };
  } finally {
    await geo.dispose();
  }
});

export const sdkRouteBasic = test('sdk.route-basic', 'Rota: Kadıköy - Beşiktaş mesafe, süre ve çizgi', async (ctx) => {
  const { geo } = await ensureRoute(ctx);
  try {
    const started = Date.now();
    const route = await geo.route.route(KADIKOY, BESIKTAS);
    const ms = Date.now() - started;
    if (!route.ok) return { outcome: 'fail', note: `rota yok: ${route.code}` };
    const km = route.distanceM / 1000;
    const minutes = route.durationS / 60;
    if (km < 9 || km > 22) return { outcome: 'fail', note: `mesafe ${km.toFixed(1)} km beklenen 9-22 aralığında değil` };
    if (minutes < 10 || minutes > 45) return { outcome: 'fail', note: `süre ${minutes.toFixed(0)} dk beklenen 10-45 aralığında değil` };
    if (route.geometry.length < 50) return { outcome: 'fail', note: `çizgi yalnızca ${route.geometry.length} nokta` };
    if (metres(route.geometry[0] as [number, number], KADIKOY) > 300) return { outcome: 'fail', note: 'çizgi başlangıçtan uzak başlıyor' };
    if (metres(route.geometry[route.geometry.length - 1] as [number, number], BESIKTAS) > 300) return { outcome: 'fail', note: 'çizgi varış noktasında bitmiyor' };
    return { outcome: 'pass', value: String(ms), unit: 'ms (ilk rota)', note: `${km.toFixed(1)} km, ${minutes.toFixed(0)} dk, ${route.geometry.length} nokta, uyarı ${route.warnings.length}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkRouteReverse = test('sdk.route-reverse', 'Rota: gidiş ve dönüş birbirine yakın', async (ctx) => {
  const { geo } = await ensureRoute(ctx);
  try {
    const there = await geo.route.route(KADIKOY, BESIKTAS);
    const back = await geo.route.route(BESIKTAS, KADIKOY);
    if (!there.ok || !back.ok) return { outcome: 'fail', note: 'gidiş ya da dönüş rotası yok' };
    const ratio = back.distanceM / there.distanceM;
    if (ratio < 0.7 || ratio > 1.4) return { outcome: 'fail', note: `dönüş/gidiş mesafe oranı ${ratio.toFixed(2)}` };
    return { outcome: 'pass', note: `gidiş ${(there.distanceM / 1000).toFixed(1)} km, dönüş ${(back.distanceM / 1000).toFixed(1)} km` };
  } finally {
    await geo.dispose();
  }
});

export const sdkRouteMotorcycle = test('sdk.route-motorcycle', 'Rota: motosiklet süresi araçtan kısa ve yaklaşık işaretli', async (ctx) => {
  const { geo } = await ensureRoute(ctx);
  try {
    const car = await geo.route.route(KADIKOY, BESIKTAS, { vehicle: 'car' });
    const moto = await geo.route.route(KADIKOY, BESIKTAS, { vehicle: 'motorcycle' });
    if (!car.ok || !moto.ok) return { outcome: 'fail', note: 'rota yok' };
    if (car.approximate || !moto.approximate) return { outcome: 'fail', note: `yaklaşık işareti araç ${car.approximate}, motosiklet ${moto.approximate}` };
    const ratio = moto.durationS / car.durationS;
    if (ratio < 0.8 || ratio > 0.9) return { outcome: 'fail', note: `motosiklet/araç süre oranı ${ratio.toFixed(3)}` };
    if (moto.distanceM !== car.distanceM) return { outcome: 'fail', note: 'motosiklet farklı yol seçti' };
    return { outcome: 'pass', note: `süre oranı ${ratio.toFixed(3)}` };
  } finally {
    await geo.dispose();
  }
});

export const sdkRouteErrors = test('sdk.route-errors', 'Rota: deniz, başka il ve ada için doğru hata kodları', async (ctx) => {
  const { geo } = await ensureRoute(ctx);
  try {
    const cases: [string, [number, number], string][] = [
      ['deniz', SEA, 'no_road'],
      ['başka il', ANKARA, 'outside_region'],
      ['ada', BUYUKADA, 'disconnected'],
    ];
    const lines: string[] = [];
    for (const [name, point, want] of cases) {
      const route = await geo.route.route(KADIKOY, point);
      if (route.ok || route.code !== want) return { outcome: 'fail', note: `${name}: beklenen ${want}, gelen ${route.ok ? 'rota' : route.code}` };
      lines.push(`${name} ${want}`);
    }
    return { outcome: 'pass', note: lines.join(', ') };
  } finally {
    await geo.dispose();
  }
});

export const sdkRouteMatrix = test('sdk.route-matrix', 'Rota matrisi: 6 nokta, köşegen sıfır, rota ile aynı süre', async (ctx) => {
  const { geo } = await ensureRoute(ctx);
  try {
    const points: [number, number][] = [KADIKOY, BESIKTAS, [28.9784, 41.0082], [29.1244, 41.0184], [28.8, 40.99], [29.2, 40.92]];
    const started = Date.now();
    const matrix = await geo.route.matrix(points);
    const ms = Date.now() - started;
    if (!matrix.ok) return { outcome: 'fail', note: `matris ${matrix.code}` };
    const bad = matrix.stops.findIndex((s) => !s.ok);
    if (bad >= 0) return { outcome: 'fail', note: `${bad}. nokta yola oturmadı` };
    for (let i = 0; i < points.length; i++) {
      if (matrix.durationS[i]?.[i] !== 0) return { outcome: 'fail', note: `köşegen ${i} sıfır değil` };
      for (let j = 0; j < points.length; j++) if (i !== j && (matrix.durationS[i]?.[j] ?? null) === null) return { outcome: 'fail', note: `${i} - ${j} süresi boş` };
    }
    const route = await geo.route.route(KADIKOY, BESIKTAS);
    const cell = matrix.durationS[0]?.[1];
    if (!route.ok || cell === null || cell === undefined || Math.abs(cell - route.durationS) > 1) return { outcome: 'fail', note: `matris ${cell} sn, rota ${route.ok ? route.durationS : route.code}` };
    return { outcome: 'pass', value: String(ms), unit: 'ms (6x6)', note: `0 - 1 süresi rotayla aynı: ${Math.round(cell)} sn` };
  } finally {
    await geo.dispose();
  }
});

export const ROUTE_TESTS: DeviceTest[] = [sdkRouteInstall, sdkRouteBasic, sdkRouteReverse, sdkRouteMotorcycle, sdkRouteErrors, sdkRouteMatrix];
