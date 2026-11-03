import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha256';
import { partPath } from '../../../../src/core/packs/paths';
import { isPackError } from '../../../../src/core/packs/types';
import { seededBytesAsync } from '../../../../scripts/spikes/blob';
import { FileStore } from './fileStore';
import { fetchManifest, installFile, packFile } from './pack-download';
import { nextTurn } from '../ui-yield';
import { cuttingFs } from '../install';
import { recordingNet, resumedWithRange } from '../recording-fetch';
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
    let cut: ReturnType<typeof cuttingFs> | null = null;
    let recorded: ReturnType<typeof recordingNet> | null = null;
    let lastStep = -1;
    const result = await installFile(ctx, entry, {
      wrapFs: (fs) => (cut = cuttingFs(fs, Math.floor(entry.size * 0.3))),
      wrapNet: (net) => (recorded = recordingNet(net)),
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
    const interrupted = (cut as ReturnType<typeof cuttingFs> | null)?.interrupted === true;
    const calls = (recorded as ReturnType<typeof recordingNet> | null)?.calls ?? [];
    if (again !== entry.sha256) return { outcome: 'fail', note: 'son dosyanın SHA-256 değeri manifestle uyuşmuyor' };
    if (!interrupted) return { outcome: 'fail', note: 'kesinti yaşanmadı, devam edilemedi' };
    if (result.retries < 1) return { outcome: 'fail', note: 'devam isteği görülmedi' };
    if (!resumedWithRange(calls)) return { outcome: 'fail', note: `devam isteği Range ile 206 almadı: ${JSON.stringify(calls)}` };
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
    const target = 'space-probe';
    const probe = new File(`${ctx.packsDir.replace(/\/$/, '')}/${partPath(target)}`);
    if (probe.exists) probe.delete();
    try {
      await installFile(ctx, entry, { to: target, wrapFs: (fs) => ({ ...fs, freeBytes: async () => 1000 }) });
      return { outcome: 'fail', note: 'indirme reddedilmedi' };
    } catch (error) {
      const code = isPackError(error) ? error.code : String(error);
      const size = probe.exists ? probe.size : 0;
      if (code === 'no-space' && size === 0) return { outcome: 'pass', value: code, note: `boş alan ${Math.round(Paths.availableDiskSpace / 1048576)} MB` };
      return { outcome: 'fail', note: `beklenmeyen sonuç ${code}, dosya boyutu ${size}` };
    } finally {
      if (probe.exists) probe.delete();
      const placed = packFile(ctx, target);
      if (placed.exists) placed.delete();
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
