import type { PartKind } from '../../../../src/core';
import { createGeoNative } from '../../../../src/native';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { sandbox } from '../sandbox';

const PARTS: PartKind[] = ['address', 'buildings', 'directory', 'places', 'route', 'tiles'];
const MB = 1e6;

type Hermes = { getInstrumentedStats?: () => Record<string, unknown> };
const live = (): number => {
  const stats = (globalThis as { HermesInternal?: Hermes }).HermesInternal?.getInstrumentedStats?.();
  return typeof stats?.js_externalBytes === 'number' && typeof stats.js_heapSize === 'number' ? stats.js_externalBytes + stats.js_heapSize : 0;
};

type Seen = { maxGapMs: number; peakMB: number; floorMB: number; gaps: string; marks: string };

function watch(): { mark(done: number): void; stop(): Seen } {
  const floor = live();
  const t0 = Date.now();
  let peak = floor;
  let maxGap = 0;
  let last = t0;
  let at = 0;
  const gaps: { t: number; ms: number; at: number }[] = [];
  const marks: string[] = [];
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > maxGap) maxGap = now - last;
    if (now - last >= 150) gaps.push({ t: last - t0, ms: now - last, at });
    last = now;
    peak = Math.max(peak, live());
  }, 10);
  let lastMark = -1;
  return {
    mark(done) {
      at = done;
      const bucket = Math.floor(done / (5 * MB));
      if (bucket !== lastMark) {
        lastMark = bucket;
        marks.push(`${Math.round((Date.now() - t0) / 1000)}s:${(done / MB).toFixed(0)}`);
      }
    },
    stop() {
      clearInterval(timer);
      const top = [...gaps].sort((a, b) => b.ms - a.ms).slice(0, 6).map((gap) => `${Math.round(gap.t / 1000)}s@${(gap.at / MB).toFixed(0)}MB=${gap.ms}ms`);
      return { maxGapMs: maxGap, peakMB: peak / MB, floorMB: floor / MB, gaps: `${gaps.length} boşluk ≥150 ms; en uzunlar ${top.join(' ')}`, marks: marks.join(' ') };
    },
  };
}

const patchUpdate = (id: string): DeviceTest => ({
  id: `sdk.patch-update-${id}`,
  title: `Fark güncellemesi ${id}: eski sürüm kurulu, yeni sürüm yamayla iner`,
  kind: 'auto',
  async run(ctx) {
    const oldUrl = `${ctx.packServerUrl}/before/manifest-v1.json`;
    const newUrl = `${ctx.packServerUrl}/manifest-v1.json`;
    const probe = await fetch(oldUrl);
    if (!probe.ok) return { outcome: 'fail', note: `eski sürüm manifesti yok (HTTP ${probe.status}); sunucuyu dist/patch-test ile başlat` };
    const dir = sandbox(`patch-update-${id}`, true);
    const keys = PUBLIC_KEY ? [PUBLIC_KEY] : [];
    const first = await createGeoNative({ manifestUrl: oldUrl, publicKeys: keys, directory: dir });
    let before: string | null;
    let installMs = 0;
    let installBytes = 0;
    try {
      const checked = await first.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `eski manifest: ${checked.code}` };
      const parts = PARTS.filter((kind) => kind !== 'buildings' || id !== '16');
      installBytes = first.regions.downloadBytes(id, parts);
      const installStarted = Date.now();
      await first.regions.download(id, { parts });
      installMs = Date.now() - installStarted;
      before = first.regions.status(id).installedVersion;
    } finally {
      await first.dispose();
    }
    const second = await createGeoNative({ manifestUrl: newUrl, publicKeys: keys, directory: dir });
    try {
      const checked = await second.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `yeni manifest: ${checked.code}` };
      const planned = second.regions.status(id);
      if (planned.state !== 'update-available') return { outcome: 'fail', note: `güncelleme öncesi durum ${planned.state}` };
      const expected = planned.updateBytes;
      const watcher = watch();
      const started = Date.now();
      await second.regions.download(id, { onProgress: (done) => watcher.mark(done) });
      const ms = Date.now() - started;
      const seen = watcher.stop();
      const after = second.regions.status(id);
      if (after.state !== 'installed' || after.installedVersion === before) return { outcome: 'fail', note: `sonra durum ${after.state}, sürüm ${after.installedVersion}` };
      const report = after.lastUpdate;
      if (!report) return { outcome: 'fail', note: 'lastUpdate boş' };
      if (report.fellBack > 0 || report.patched === 0) return { outcome: 'fail', note: `yama kullanılmadı: ${JSON.stringify(report)}` };
      const note = `${id}: ${before} -> ${after.installedVersion}; yama ${report.patched} dosya, tam indirmeye düşen ${report.fellBack}; indirilen ${(report.bytes / MB).toFixed(1)} MB (beklenen ${expected === null ? '?' : (expected / MB).toFixed(1)} MB); en uzun JS boşluğu ${seen.maxGapMs} ms; JS bellek tabanı ${seen.floorMB.toFixed(0)} MB, tepe ${seen.peakMB.toFixed(0)} MB; karşılaştırma: ilk kurulum ${(installBytes / MB).toFixed(1)} MB ${installMs} ms; ${seen.gaps}; ilerleme sn:MB ${seen.marks}`;
      return { outcome: 'pass', value: String(ms), unit: 'ms (güncelleme)', note };
    } finally {
      await second.dispose();
    }
  },
});

export const PATCH_TESTS: DeviceTest[] = [patchUpdate('16'), patchUpdate('34')];
