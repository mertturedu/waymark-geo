import type { DeviceReport, ReportEntry } from '../../../src/core';
import type { DeviceTest, TestContext } from './types';

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runTest(test: DeviceTest, ctx: TestContext, timeoutMs: number): Promise<ReportEntry> {
  const identity = { id: test.id, title: test.title, kind: test.kind };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`zaman aşımı (${timeoutMs} ms)`)), timeoutMs);
  });
  try {
    const result = await Promise.race([test.run(ctx), timeout]);
    return { ...identity, ...result };
  } catch (error) {
    return { ...identity, outcome: 'fail', note: message(error) };
  } finally {
    clearTimeout(timer);
  }
}

const pad = (n: number): string => String(n).padStart(2, '0');

const stamp = (d: Date): string =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

export function buildReport(
  entries: ReportEntry[],
  info: { device: DeviceReport['device']; sdk: DeviceReport['sdk']; now: Date },
): DeviceReport {
  const model = info.device.model.replace(/[^A-Za-z0-9._-]/g, '');
  return {
    reportId: `${model || 'cihaz'}-${stamp(info.now)}`,
    createdAt: info.now.toISOString(),
    device: info.device,
    sdk: info.sdk,
    entries,
  };
}
