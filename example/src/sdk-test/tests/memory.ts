import * as Device from 'expo-device';
import type { DeviceTest } from '../../device-test/types';

type Hermes = { getRuntimeProperties?: () => Record<string, unknown> };

export function heapNote(): string {
  const hermes = (globalThis as { HermesInternal?: Hermes }).HermesInternal;
  const props = hermes?.getRuntimeProperties?.();
  const heap = props ? Object.entries(props).filter(([key]) => /heap|alloc/i.test(key)) : [];
  return heap.length > 0 ? heap.map(([key, value]) => `${key} ${String(value)}`).join(', ') : 'JS yığın bilgisi okunamadı';
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
