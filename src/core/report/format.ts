import { crc32 } from './crc32';
import { escapeField } from './escape';
import type { DeviceReport } from './types';

const join = (...fields: (string | number | null | undefined)[]): string =>
  fields.map((field) => (field === null || field === undefined ? '' : escapeField(String(field)))).join('|');

export function formatReport(report: DeviceReport): string {
  const lines = [
    'YUKSI-GEO-REPORT v1',
    `id: ${escapeField(report.reportId)};`,
    `created: ${escapeField(report.createdAt)};`,
    `device: ${join(report.device.model, report.device.os, report.device.memoryMB)};`,
    `sdk: ${join(report.sdk.version, report.sdk.dataVersion, report.sdk.build)};`,
    ...report.entries.map(
      (e) => `@ ${join(e.id, e.title, e.kind, e.outcome, e.value, e.unit, e.threshold, e.note)};`,
    ),
  ];
  const body = lines.join('\n') + '\n';
  return `${body}END ${report.entries.length} ${crc32(body).toString(16).padStart(8, '0')}\n`;
}
