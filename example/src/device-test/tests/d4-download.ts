import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { DownloadError, download } from '../../../../scripts/spikes/resume-download';
import { seededBytesAsync } from '../../../../scripts/spikes/blob';
import { CuttingStore, FileStore } from './fileStore';
import { fetchImpl, fetchManifest, installFile, packFile } from './pack-download';
import { nextTurn } from '../ui-yield';
import { recordingFetch, resumedWithRange } from '../recording-fetch';
import { nativeStoreSha256 } from './native-hash';
import type { DeviceTest } from '../types';

const BIG = 'istanbul.pmtiles';

export const d4ResumeDownload: DeviceTest = {
  id: 'd4.resume-download',
  title: 'İstanbul haritası (84 MB) indirme: kesinti, devam, SHA-256',
  kind: 'auto',
  async run(ctx) {
    const manifest = await fetchManifest(ctx.packServerUrl);
    const entry = manifest.files.find((f) => f.path === BIG);
    if (!entry) return { outcome: 'fail', note: `${BIG} manifestte yok` };
    const final = packFile(ctx, BIG);
    if (final.exists) final.delete();
    const started = Date.now();
    let cutStore: CuttingStore | null = null;
    let lastStep = -1;
    const recorded = recordingFetch(fetchImpl);
    const result = await installFile(ctx, entry, {
      fetchImpl: recorded.fetch,
      wrapStore: (store) => (cutStore = new CuttingStore(store, Math.floor(entry.size * 0.3))),
      onProgress: (done, total) => {
        const step = Math.floor((10 * done) / total);
        if (step !== lastStep) {
          lastStep = step;
          ctx.log(`d4 %${step * 10} (${Math.round(done / 1048576)} MB)`);
        }
      },
    });
    const totalMs = Date.now() - started;
    const hashStarted = Date.now();
    const verifyStore = new FileStore(final);
    const again = await nativeStoreSha256(verifyStore, entry.size);
    verifyStore.close();
    const shaMs = Date.now() - hashStarted;
    const interrupted = (cutStore as CuttingStore | null)?.interrupted === true;
    if (again !== entry.sha256) return { outcome: 'fail', note: 'son dosyanın SHA-256 değeri manifestle uyuşmuyor' };
    if (!interrupted) return { outcome: 'fail', note: 'kesinti yaşanmadı, devam edilemedi' };
    if (result.retries < 1) return { outcome: 'fail', note: 'devam isteği görülmedi' };
    if (!resumedWithRange(recorded.calls)) return { outcome: 'fail', note: `devam isteği Range ile 206 almadı: ${JSON.stringify(recorded.calls)}` };
    return { outcome: 'pass', value: String(totalMs), unit: 'ms (kesinti ve devam dahil)', threshold: 'kesinti, devam, SHA eşleşmesi', note: `yeniden deneme ${result.retries}, devam isteği 206, ayrı SHA-256 doğrulaması ${shaMs} ms` };
  },
};

export const d4InsufficientSpace: DeviceTest = {
  id: 'd4.insufficient-space',
  title: 'Yetersiz alanda indirme başlamadan reddedilir',
  kind: 'auto',
  async run(ctx) {
    const manifest = await fetchManifest(ctx.packServerUrl);
    const entry = manifest.files.find((f) => f.path === BIG);
    if (!entry) return { outcome: 'fail', note: `${BIG} manifestte yok` };
    const probe = new File(`${ctx.packsDir.replace(/\/$/, '')}/.part/space-probe`);
    if (probe.exists) probe.delete();
    const store = new FileStore(probe);
    try {
      await download({ url: `${ctx.packServerUrl}/${BIG}`, store, sha256: entry.sha256, fetchImpl, maxRetries: 1, freeBytes: async () => 1000 });
      return { outcome: 'fail', note: 'indirme reddedilmedi' };
    } catch (error) {
      const code = error instanceof DownloadError ? error.code : String(error);
      const size = await store.size();
      if (code === 'INSUFFICIENT_SPACE' && size === 0) return { outcome: 'pass', value: code, note: `boş alan ${Math.round(Paths.availableDiskSpace / 1048576)} MB` };
      return { outcome: 'fail', note: `beklenmeyen sonuç ${code}, dosya boyutu ${size}` };
    } finally {
      store.close();
      if (probe.exists) probe.delete();
    }
  },
};

export const d4ShaMethods: DeviceTest = {
  id: 'd4.sha-methods',
  title: 'SHA-256 yöntemleri (30 MiB): @noble/hashes ve expo-crypto',
  kind: 'auto',
  async run() {
    const bytes = await seededBytesAsync(42, 30 * 1024 * 1024, nextTurn);
    const hash = sha256.create();
    let nobleMs = 0;
    for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
      const t0 = Date.now();
      hash.update(bytes.subarray(offset, offset + 1024 * 1024));
      nobleMs += Date.now() - t0;
      await nextTurn();
    }
    const noble = bytesToHex(hash.digest());
    const t1 = Date.now();
    const native = bytesToHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)));
    const nativeMs = Date.now() - t1;
    if (noble !== native) return { outcome: 'fail', note: 'iki yöntem farklı sonuç verdi' };
    return { outcome: 'info', value: `${nobleMs} / ${nativeMs}`, unit: 'ms (noble / expo-crypto)', threshold: 'kayıt amaçlı' };
  },
};
