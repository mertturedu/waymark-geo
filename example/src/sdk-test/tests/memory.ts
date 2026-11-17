import * as Device from 'expo-device';
import type { DeviceTest } from '../../device-test/types';

type Hermes = { getRuntimeProperties?: () => Record<string, unknown>; getInstrumentedStats?: () => Record<string, unknown> };

export function heapNote(): string {
  const hermes = (globalThis as { HermesInternal?: Hermes }).HermesInternal;
  const props = hermes?.getRuntimeProperties?.();
  const heap = props ? Object.entries(props).filter(([key]) => /heap|alloc/i.test(key)) : [];
  if (heap.length > 0) return heap.map(([key, value]) => `${key} ${String(value)}`).join(', ');
  const stats = hermes?.getInstrumentedStats?.();
  const mb = (key: string): string | null => (typeof stats?.[key] === 'number' ? `${((stats[key] as number) / (1024 * 1024)).toFixed(1)} MB` : null);
  const parts = [['yığın', mb('js_heapSize')], ['ayrılan', mb('js_allocatedBytes')]].filter(([, value]) => value !== null).map(([key, value]) => `${key} ${value}`);
  return parts.length > 0 ? parts.join(', ') : 'JS yığın bilgisi okunamadı';
}

export const sdkMemory: DeviceTest = {
  id: 'sdk.memory',
  title: 'Bellek: JS yığını (bilgi)',
  kind: 'auto',
  async run() {
    const total = Device.totalMemory ? `${Math.round(Device.totalMemory / (1024 * 1024))} MB` : 'bilinmiyor';
    return { outcome: 'info', value: heapNote(), note: `cihaz belleği ${total}; bu test arama hız testinden sonra çalışır, yığın o zamanki değeri gösterir` };
  },
};
