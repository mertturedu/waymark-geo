import { createZstdDecode } from '../../../../src/core/packs/zstd';
import type { Manifest } from '../../../../src/core/region/manifest';
import type { DeviceTest } from '../../device-test/types';
import { test } from './map-tour';

const REGION = '16';
const CHUNK = 256 * 1024;
const MIN_MBPS = 5;

export const sdkZstdSpeed: DeviceTest = test('sdk.zstd-speed', `Sıkıştırma: Bursa rehber paketi cihazda açılır, boyutu ve SQLite başlığı doğru, hızı en az ${MIN_MBPS} MB/sn`, async (ctx) => {
  const base = ctx.packServerUrl;
  const manifest = (await (await fetch(`${base}/manifest-v1.json`)).json()) as Manifest;
  const file = manifest.regions.find((region) => region.id === REGION)?.files.find((entry) => entry.kind === 'directory');
  if (!file?.encoded) return { outcome: 'fail', note: 'manifestte sıkıştırılmış rehber dosyası yok' };
  const packed = new Uint8Array(await (await fetch(`${base}/${file.encoded.path}`)).arrayBuffer());
  if (packed.length !== file.encoded.size) return { outcome: 'fail', note: `indirilen ${packed.length}, manifest ${file.encoded.size}` };
  const stream = createZstdDecode().zstd();
  const started = Date.now();
  let produced = 0;
  let head = '';
  for (let offset = 0; offset < packed.length; offset += CHUNK) {
    for (const piece of stream.push(packed.subarray(offset, Math.min(packed.length, offset + CHUNK)), offset + CHUNK >= packed.length)) {
      if (produced === 0) head = String.fromCharCode(...piece.subarray(0, 15));
      produced += piece.length;
    }
  }
  const seconds = Math.max(0.001, (Date.now() - started) / 1000);
  const mbps = produced / 1e6 / seconds;
  const note = `${(packed.length / 1e6).toFixed(1)} MB → ${(produced / 1e6).toFixed(1)} MB, ${seconds.toFixed(1)} sn, ${mbps.toFixed(1)} MB/sn`;
  if (produced !== file.size) return { outcome: 'fail', note: `${note}; açılan boyut ${produced}, beklenen ${file.size}` };
  if (head !== 'SQLite format 3') return { outcome: 'fail', note: `${note}; başlık "${head}"` };
  return { outcome: mbps >= MIN_MBPS ? 'pass' : 'fail', value: mbps.toFixed(1), unit: 'MB/sn', threshold: `≥ ${MIN_MBPS}`, note };
});

export const ZSTD_TESTS: DeviceTest[] = [sdkZstdSpeed];
