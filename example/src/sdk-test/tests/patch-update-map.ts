import type { GeoNative, PlanControls } from '../../../../src/native';
import { createGeoNative } from '../../../../src/native';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { openTour } from '../map-tour/driver';
import { sandbox } from '../sandbox';
import { FULL, HINT } from './helpers';
import { KADIKOY, ROADS, count, settle } from './map-tour';

const SPOTS: [number, number][] = [KADIKOY, [29.0097, 41.0422], [29.0153, 41.0226], [28.9877, 41.0602]];

export const sdkPatchUpdateMap: DeviceTest = {
  id: 'sdk.patch-update-map',
  title: 'Fark güncellemesi sırasında harita çizilmeye ve arama çalışmaya devam eder',
  kind: 'auto',
  async run(ctx) {
    const root = `${ctx.packServerUrl}/map`;
    if (!(await fetch(`${root}/before/manifest-v1.json`)).ok) return { outcome: 'fail', note: 'dist/patch-test/map yok; build-patch-testset.ts --base --regions 34 --out dist/patch-test/map ile kur' };
    const dir = sandbox('patch-update-map', true);
    const keys = PUBLIC_KEY ? [PUBLIC_KEY] : [];
    const first = await createGeoNative({ manifestUrl: `${root}/before/manifest-v1.json`, publicKeys: keys, directory: dir });
    try {
      const checked = await first.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `eski manifest: ${checked.code}` };
      await first.regions.download('34', { parts: ['address', 'tiles', 'places'] });
    } finally {
      await first.dispose();
    }
    const geo: GeoNative = await createGeoNative({ manifestUrl: `${root}/manifest-v1.json`, publicKeys: keys, directory: dir });
    const tour = await openTour<GeoNative, PlanControls>(geo);
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      await tour.ready();
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `yeni manifest: ${checked.code}` };
      if (geo.regions.status('34').state !== 'update-available') return { outcome: 'fail', note: `güncelleme öncesi durum ${geo.regions.status('34').state}` };
      await tour.go({ center: KADIKOY, zoom: 15 }, 'jump');
      const before = (await settle(tour, ROADS, 1)).length;
      if (before === 0) return { outcome: 'fail', note: 'güncellemeden önce çizilmiş yol yok' };
      const query = FULL[0]!.text;
      for (const spot of SPOTS) {
        await tour.go({ center: spot, zoom: 15 }, 'jump');
        await tour.until(ROADS, 1, 8000);
        await geo.search.resolve(query, HINT);
      }
      const calm = await tour.gaps(async () => {
        for (let round = 0; round < 8; round++) {
          await tour.go({ center: SPOTS[round % SPOTS.length]!, zoom: 14 + (round % 3) }, 'jump');
          await tour.until(ROADS, 1, 5000);
          await tour.query(ROADS);
          await geo.search.resolve(query, HINT);
        }
      });
      const framesBefore = tour.frames();
      let finished = false;
      const t0 = Date.now();
      let progress = 0;
      let round = 0;
      let last = t0;
      let lastStyles = tour.styleLoads();
      const stalls: { at: number; ms: number; progress: number; round: number; styles: number }[] = [];
      timer = setInterval(() => {
        const now = Date.now();
        const styles = tour.styleLoads();
        if (now - last >= 300) stalls.push({ at: last - t0, ms: now - last, progress, round, styles: styles - lastStyles });
        last = now;
        lastStyles = styles;
      }, 16);
      const update = geo.regions.download('34', { onProgress: (done) => (progress = done) }).finally(() => {
        finished = true;
      });
      const during = await tour.gaps(async () => {
        const roads: number[] = [];
        const statuses: string[] = [];
        for (; !finished && round < 400; round++) {
          await tour.go({ center: SPOTS[round % SPOTS.length]!, zoom: 14 + (round % 3) }, 'jump');
          await tour.until(ROADS, 1, 5000);
          roads.push((await tour.query(ROADS)).length);
          statuses.push((await geo.search.resolve(query, HINT)).status);
        }
        return { roads, statuses };
      });
      await update;
      clearInterval(timer);
      const worst = [...stalls].sort((a, b) => b.ms - a.ms).slice(0, 5).map((stall) => `${Math.round(stall.at / 1000)}s tur${stall.round} ${(stall.progress / 1e6).toFixed(0)}MB stil+${stall.styles}=${stall.ms}ms`);
      const status = geo.regions.status('34');
      if (status.state !== 'installed') return { outcome: 'fail', note: `güncelleme sonrası durum ${status.state}` };
      const report = status.lastUpdate;
      if (!report || report.patched === 0 || report.fellBack > 0) return { outcome: 'fail', note: `yama kullanılmadı: ${JSON.stringify(report)}` };
      await tour.go({ center: KADIKOY, zoom: 15 }, 'jump');
      const after = (await settle(tour, ROADS, 1)).length;
      const { roads, statuses } = during.value;
      const frames = tour.frames() - framesBefore;
      const note = `${roads.length} tur; güncelleme sürerken yol sayısı en az ${Math.min(...roads)}, çözülen arama ${statuses.filter((s) => s === 'resolved').length}/${statuses.length}; çizilen kare ${frames}; en uzun JS boşluğu ${during.maxGapMs} ms; güncelleme öncesi ${before}, sonrası ${after} yol; yama ${report.patched} dosya, ${(report.bytes / 1e6).toFixed(1)} MB; güncelleme olmadan aynı döngüde en uzun JS boşluğu ${calm.maxGapMs} ms; güncelleme ${Math.round((Date.now() - t0) / 1000)} sn; ≥300 ms boşluk ${stalls.length}: ${worst.join(' | ')}`;
      if (roads.length === 0) return { outcome: 'fail', note: `güncelleme bir turdan önce bitti; ${note}` };
      const ok = Math.min(...roads) > 0 && statuses.every((s) => s === 'resolved') && frames > 0 && after > 0;
      return { outcome: ok ? 'pass' : 'fail', value: String(during.maxGapMs), unit: 'ms (güncelleme sırasında en uzun JS boşluğu)', note };
    } finally {
      clearInterval(timer);
      tour.close();
      await geo.dispose();
    }
  },
};
