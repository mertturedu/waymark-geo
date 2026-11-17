import fc from 'fast-check';
import { formatReport } from '../../src/core/report/format';
import { parseReport } from '../../src/core/report/parse';
import type { DeviceReport, ReportEntry } from '../../src/core/report/types';

const text = fc.oneof(fc.string({ unit: 'grapheme' }), fc.string({ unit: 'binary' }), fc.constantFrom('İ', 'ı', '|', '\\', '\n', '\r\n', ' ', '😀'));
const optional = fc.option(fc.string({ unit: 'grapheme', minLength: 1 }), { nil: undefined });

const entry: fc.Arbitrary<ReportEntry> = fc.record(
  {
    id: text,
    title: text,
    kind: fc.constantFrom('auto' as const, 'manual' as const),
    outcome: fc.constantFrom('pass' as const, 'fail' as const, 'skip' as const, 'info' as const),
    value: optional,
    unit: optional,
    threshold: optional,
    note: optional,
  },
  { requiredKeys: ['id', 'title', 'kind', 'outcome'] },
);

const report: fc.Arbitrary<DeviceReport> = fc.record({
  reportId: text,
  createdAt: text,
  device: fc.record({ model: text, os: text, memoryMB: fc.option(fc.nat({ max: 65536 }), { nil: undefined }) }, { requiredKeys: ['model', 'os'] }),
  sdk: fc.record({
    version: text,
    dataVersion: fc.option(fc.string({ unit: 'grapheme', minLength: 1 }), { nil: null }),
    build: fc.constantFrom('release' as const, 'debug' as const),
  }),
  entries: fc.array(entry, { maxLength: 8 }),
});

const strip = (r: DeviceReport): DeviceReport => JSON.parse(JSON.stringify(r)) as DeviceReport;

describe('report round trip', () => {
  it('parse(format(r)) equals r for arbitrary reports', () => {
    fc.assert(
      fc.property(report, (r) => {
        expect(parseReport(formatReport(r))).toEqual({ ok: true, report: strip(r) });
      }),
      { numRuns: 1000 },
    );
  });

  it('never accepts a text with one character replaced', () => {
    fc.assert(
      fc.property(report, fc.nat(), fc.constantFrom('x', '0', 'İ', ' '), (r, at, replacement) => {
        const original = formatReport(r);
        const position = at % original.length;
        if (original[position] === replacement || original.slice(position).trim() === '') return;
        const changed = original.slice(0, position) + replacement + original.slice(position + 1);
        const result = parseReport(changed);
        if (result.ok) expect(formatReport(result.report)).toBe(changed);
      }),
      { numRuns: 1000 },
    );
  });
});
