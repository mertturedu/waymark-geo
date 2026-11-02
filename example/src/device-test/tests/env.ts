import * as Device from 'expo-device';
import { build } from '../env';
import type { ProbeResult } from '../find-server';
import { describeProbeFailure } from '../probe-error';
import type { DeviceTest } from '../types';

const PROBE_TIMEOUT_MS = 5000;

export const envInfo: DeviceTest = {
  id: 'env.info',
  title: 'Cihaz bilgisi',
  kind: 'auto',
  async run() {
    const memory = Device.totalMemory ? `${Math.round(Device.totalMemory / (1024 * 1024))} MB` : 'bellek bilinmiyor';
    return { outcome: 'info', value: `${Device.modelName ?? 'cihaz'}, ${Device.osName ?? ''} ${Device.osVersion ?? ''}, ${memory}, ${build()}`.replace(/\s+/g, ' ') };
  },
};

export async function probeServer(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeResult> {
  if (!url) return { ok: false, note: 'sunucu adresi girilmedi' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${url}/health`, { signal: controller.signal });
    if (!response.ok) return { ok: false, note: `sunucu HTTP ${response.status} verdi: ${url}` };
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, note: describeProbeFailure(url, error, Date.now() - started, timeoutMs) };
  } finally {
    clearTimeout(timer);
  }
}

export const envPackServer: DeviceTest = {
  id: 'env.pack-server',
  title: 'Paket sunucusuna erişim',
  kind: 'auto',
  async run(ctx) {
    const result = await probeServer(ctx.packServerUrl);
    return result.ok ? { outcome: 'pass', value: String(result.ms), unit: 'ms' } : { outcome: 'fail', note: result.note };
  },
};
