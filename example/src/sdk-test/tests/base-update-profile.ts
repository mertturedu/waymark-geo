import { Directory, Paths } from 'expo-file-system';
import { createGeo } from '../../../../src/core/create-geo';
import type { FsPort } from '../../../../src/core/packs/ports';
import { createZstdDecode } from '../../../../src/core/packs/zstd';
import { createExpoConnectivity } from '../../../../src/native/platform/connectivity';
import { createExpoFs } from '../../../../src/native/platform/fs';
import { createExpoHash } from '../../../../src/native/platform/hash';
import { createExpoLearnStore } from '../../../../src/native/platform/learn-store';
import { createExpoNet } from '../../../../src/native/platform/network';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { sandbox } from '../sandbox';

type Cost = { calls: number; total: number; max: number };

function timed(fs: FsPort, costs: Map<string, Cost>): FsPort {
  const wrapped = { ...fs } as Record<string, unknown>;
  for (const [name, original] of Object.entries(fs) as [string, (...args: unknown[]) => unknown][]) {
    wrapped[name] = (...args: unknown[]) => {
      const started = Date.now();
      const result = original(...args);
      const spent = Date.now() - started;
      const cost = costs.get(name) ?? { calls: 0, total: 0, max: 0 };
      cost.calls += 1;
      cost.total += spent;
      if (spent > cost.max) cost.max = spent;
      costs.set(name, cost);
      return result;
    };
  }
  return wrapped as FsPort;
}

const clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

async function openProfiled(manifestUrl: string, root: Directory, costs: Map<string, Cost>) {
  const fs = timed(createExpoFs(root), costs);
  return createGeo({ manifestUrl, publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [] }, { fs, net: createExpoNet(), hash: createExpoHash(fs), clock, decode: createZstdDecode(), connectivity: createExpoConnectivity(), opener: createExpoOpener(root), learnStore: createExpoLearnStore(root) });
}

export const sdkBaseUpdateProfile: DeviceTest = {
  id: 'sdk.base-update-profile',
  title: 'Taban paketi güncellemesi: hangi dosya sistemi çağrısı JS iş parçacığını tutuyor (bilgi)',
  kind: 'auto',
  async run(ctx) {
    const root = `${ctx.packServerUrl}/base`;
    if (!(await fetch(`${root}/before/manifest-v1.json`)).ok) return { outcome: 'fail', note: 'dist/patch-test/base yok' };
    const dir = sandbox('base-profile', true);
    const first = await openProfiled(`${root}/before/manifest-v1.json`, dir, new Map());
    try {
      const checked = await first.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `eski manifest: ${checked.code}` };
      await first.regions.download('16', { parts: ['tiles'] });
    } finally {
      await first.dispose();
    }
    const costs = new Map<string, Cost>();
    const geo = await openProfiled(`${root}/manifest-v1.json`, dir, costs);
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `yeni manifest: ${checked.code}` };
      const need = geo.regions.missingBaseBytes();
      costs.clear();
      const t0 = Date.now();
      let last = t0;
      let progress = 0;
      let maxGap = 0;
      const stalls: string[] = [];
      const timer = setInterval(() => {
        const now = Date.now();
        if (now - last > maxGap) maxGap = now - last;
        if (now - last >= 300) stalls.push(`${((last - t0) / 1000).toFixed(1)}s@${(progress / 1e6).toFixed(0)}MB=${now - last}ms`);
        last = now;
      }, 16);
      try {
        await geo.regions.download('16', { parts: ['tiles'], onProgress: (done) => (progress = done) });
      } finally {
        clearInterval(timer);
      }
      const rows = [...costs.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6).map(([name, cost]) => `${name} ${cost.calls}× toplam ${cost.total} ms, en uzun ${cost.max} ms`);
      const free = Paths.availableDiskSpace;
      return { outcome: 'info', value: String(maxGap), unit: 'ms (en uzun JS boşluğu)', note: `taban ${(need / 1e6).toFixed(1)} MB; güncelleme ${Math.round((Date.now() - t0) / 1000)} sn; ≥300 ms boşluk ${stalls.length}: ${stalls.slice(0, 6).join(' ')}; eşzamanlı kısım en çok tutan çağrılar: ${rows.join(' | ')}; boş yer ${(free / 1e9).toFixed(1)} GB` };
    } finally {
      await geo.dispose();
    }
  },
};
