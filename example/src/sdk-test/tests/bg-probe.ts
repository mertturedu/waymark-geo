import { DownloadTask, File } from 'expo-file-system';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

type Entry = { kind: string; path: string; size: number };

export const sdkBgProbe: DeviceTest = {
  id: 'sdk.bg-probe',
  title: 'Deneme: DownloadTask arka planda sürer mi (bilgi)',
  kind: 'auto',
  async run(ctx) {
    const manifest = (await (await fetch(`${ctx.packServerUrl}/manifest-v1.json`)).json()) as { regions: { id: string; files: Entry[] }[] };
    const tiles = manifest.regions.find((region) => region.id === '34')?.files.find((file) => file.kind === 'tiles');
    if (!tiles) return { outcome: 'fail', note: 'İstanbul karo dosyası manifestte yok' };
    const dir = sandbox('bg-probe', true);
    const target = new File(dir, 'probe.bin');
    const ticks: string[] = [];
    const started = Date.now();
    let last = 0;
    const task = new DownloadTask(`${ctx.packServerUrl}/${tiles.path}?rate=2000000`, target, {
      sessionType: 'background',
      onProgress: (progress) => {
        const now = Date.now();
        if (now - last >= 2000) {
          last = now;
          ticks.push(`${Math.round((now - started) / 1000)}sn:${Math.round(progress.bytesWritten / (1024 * 1024))}MB`);
        }
      },
    });
    const file = await task.downloadAsync();
    const seconds = (Date.now() - started) / 1000;
    const size = file?.size ?? -1;
    if (file) file.delete();
    const ok = size === tiles.size;
    return { outcome: ok ? 'info' : 'fail', value: seconds.toFixed(1), unit: 'sn', note: `${Math.round(tiles.size / (1024 * 1024))} MB istendi, ${Math.round(size / (1024 * 1024))} MB geldi; ilerleme ${ticks.join(' ')}` };
  },
};

export const PROBE_TESTS: DeviceTest[] = [sdkBgProbe];
