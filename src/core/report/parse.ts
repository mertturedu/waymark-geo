import { crc32 } from './crc32';
import { splitFields } from './escape';
import type { DeviceReport, Outcome, ReportEntry, ReportError } from './types';

export type ParseResult = { ok: true; report: DeviceReport } | { ok: false; error: ReportError; line?: number };

const OUTCOMES: Outcome[] = ['pass', 'fail', 'skip', 'info'];
const END_LINE = /^END (\d+) ([0-9a-f]{8})$/;

const fail = (error: ReportError, line?: number): ParseResult => (line === undefined ? { ok: false, error } : { ok: false, error, line });

const body = (line: string): string | null => (line.endsWith(';') ? line.slice(0, -1) : null);

const single = (line: string, prefix: string): string | null => {
  if (!line.startsWith(prefix)) return null;
  const inner = body(line.slice(prefix.length));
  const fields = inner === null ? null : splitFields(inner);
  return fields && fields.length === 1 ? (fields[0] as string) : null;
};

const fieldsOf = (line: string, prefix: string, count: number): string[] | null => {
  if (!line.startsWith(prefix)) return null;
  const inner = body(line.slice(prefix.length));
  const fields = inner === null ? null : splitFields(inner);
  return fields && fields.length === count ? fields : null;
};

const optional = (value: string | undefined): string | undefined => (value ? value : undefined);

function parseEntry(line: string): ReportEntry | null {
  const f = fieldsOf(line, '@ ', 8);
  if (!f) return null;
  const [id, title, kind, outcome, value, unit, threshold, note] = f as [string, string, string, string, string, string, string, string];
  if (kind !== 'auto' && kind !== 'manual') return null;
  if (!OUTCOMES.includes(outcome as Outcome)) return null;
  const entry: ReportEntry = { id, title, kind, outcome: outcome as Outcome };
  const extras = { value: optional(value), unit: optional(unit), threshold: optional(threshold), note: optional(note) };
  for (const [key, text] of Object.entries(extras)) if (text !== undefined) entry[key as 'value' | 'unit' | 'threshold' | 'note'] = text;
  return entry;
}

export function parseReport(text: string): ParseResult {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return fail('EMPTY');

  const header = lines[0] as string;
  if (!header.startsWith('YUKSI-GEO-REPORT ')) return fail('BAD_HEADER');
  if (header !== 'YUKSI-GEO-REPORT v1') return fail('UNSUPPORTED_VERSION');

  const end = END_LINE.exec(lines[lines.length - 1] as string);
  if (!end) return fail('TRUNCATED');
  const expectedHash = end[2] as string;
  const expectedCount = Number(end[1]);
  const content = lines.slice(0, -1);
  if (crc32(content.join('\n') + '\n').toString(16).padStart(8, '0') !== expectedHash) return fail('BAD_CHECKSUM');

  const reportId = single(content[1] ?? '', 'id: ');
  if (reportId === null) return fail('BAD_LINE', 2);
  const createdAt = single(content[2] ?? '', 'created: ');
  if (createdAt === null) return fail('BAD_LINE', 3);

  const device = fieldsOf(content[3] ?? '', 'device: ', 3);
  if (!device) return fail('BAD_LINE', 4);
  const memory = device[2] as string;
  if (memory !== '' && !/^\d+$/.test(memory)) return fail('BAD_LINE', 4);

  const sdk = fieldsOf(content[4] ?? '', 'sdk: ', 3);
  if (!sdk || (sdk[2] !== 'release' && sdk[2] !== 'debug')) return fail('BAD_LINE', 5);

  const entries: ReportEntry[] = [];
  for (let i = 5; i < content.length; i++) {
    const entry = parseEntry(content[i] as string);
    if (!entry) return fail('BAD_LINE', i + 1);
    entries.push(entry);
  }
  if (entries.length !== expectedCount) return fail('BAD_LINE', lines.length);

  const report: DeviceReport = {
    reportId,
    createdAt,
    device: { model: device[0] as string, os: device[1] as string, ...(memory === '' ? {} : { memoryMB: Number(memory) }) },
    sdk: { version: sdk[0] as string, dataVersion: sdk[1] === '' ? null : (sdk[1] as string), build: sdk[2] },
    entries,
  };
  return { ok: true, report };
}
