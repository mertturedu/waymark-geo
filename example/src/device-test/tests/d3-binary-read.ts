import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { equalBytes, seededBytesAsync } from '../../../../scripts/spikes/blob';
import { nextTurn } from '../ui-yield';
import type { DeviceTest } from '../types';

const SIZE = 30 * 1024 * 1024;
const SEED = 42;
const CHUNK = 1024 * 1024;

type Heap = { js_allocatedBytes?: number; js_heapSize?: number };
const heapMB = (): number | null => {
  const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Heap } }).HermesInternal?.getInstrumentedStats?.();
  return stats?.js_allocatedBytes !== undefined ? Math.round(stats.js_allocatedBytes / 1048576) : null;
};

export const d3BinaryRead: DeviceTest = {
  id: 'd3.binary-read-30mb',
  title: '30 MiB ikili dosyayı belleğe okuma',
  kind: 'auto',
  async run(ctx) {
    const dir = new Directory(Paths.cache, 'geo-d3');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, 'blob.bin');
    if (file.exists) file.delete();
    const expected = await seededBytesAsync(SEED, SIZE, nextTurn);
    file.create();
    file.write(expected);
    if (file.size !== SIZE) return { outcome: 'fail', note: `yazılan boyut ${file.size}` };

    const heapBefore = heapMB();
    const t0 = Date.now();
    const whole = await file.bytes();
    const wholeMs = Date.now() - t0;
    const wholeOk = equalBytes(whole, expected);

    const t1 = Date.now();
    const handle = file.open(FileMode.ReadOnly);
    const assembled = new Uint8Array(SIZE);
    let at = 0;
    while (at < SIZE) {
      const part = handle.readBytes(Math.min(CHUNK, SIZE - at));
      assembled.set(part, at);
      at += part.length;
    }
    handle.close();
    const chunkedMs = Date.now() - t1;
    const chunkedOk = equalBytes(assembled, expected);
    const heapAfter = heapMB();
    file.delete();
    ctx.log(`d3 whole ${wholeMs} ms, chunked ${chunkedMs} ms`);

    const heapNote = heapBefore !== null && heapAfter !== null ? `, JS yığını ${heapBefore} MB -> ${heapAfter} MB` : '';
    if (!wholeOk || !chunkedOk) return { outcome: 'fail', note: `içerik uyuşmadı (tam ${wholeOk}, parçalı ${chunkedOk})` };
    return { outcome: 'info', value: `${wholeMs} / ${chunkedMs}`, unit: 'ms (tam / 1 MiB parçalı)', threshold: 'kayıt amaçlı', note: `okunan içerik birebir aynı${heapNote}` };
  },
};
