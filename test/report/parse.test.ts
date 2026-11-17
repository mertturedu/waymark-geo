import { formatReport } from '../../src/core/report/format';
import { parseReport } from '../../src/core/report/parse';
import { crc32 } from '../../src/core/report/crc32';
import { sampleReport } from './fixtures';

const withEnd = (lines: string[]): string => {
  const body = lines.join('\n') + '\n';
  const count = lines.filter((l) => l.startsWith('@ ')).length;
  return `${body}END ${count} ${crc32(body).toString(16).padStart(8, '0')}\n`;
};

const validLines = (): string[] => formatReport(sampleReport()).trimEnd().split('\n').slice(0, -1);

describe('parseReport', () => {
  it('reads what formatReport wrote', () => {
    const result = parseReport(formatReport(sampleReport()));
    expect(result).toEqual({ ok: true, report: sampleReport() });
  });

  it('rejects empty input', () => {
    expect(parseReport('')).toEqual({ ok: false, error: 'EMPTY' });
    expect(parseReport('  \n\n')).toEqual({ ok: false, error: 'EMPTY' });
  });

  it('rejects a wrong first line', () => {
    expect(parseReport('hello\nEND 0 00000000')).toEqual({ ok: false, error: 'BAD_HEADER' });
    expect(parseReport('YUKSI-GEO-REPORT\nEND 0 00000000')).toEqual({ ok: false, error: 'BAD_HEADER' });
  });

  it('rejects another version', () => {
    const lines = validLines();
    lines[0] = 'YUKSI-GEO-REPORT v2';
    expect(parseReport(withEnd(lines))).toEqual({ ok: false, error: 'UNSUPPORTED_VERSION' });
  });

  it('rejects a report without its END line as truncated', () => {
    const text = validLines().join('\n') + '\n';
    expect(parseReport(text)).toEqual({ ok: false, error: 'TRUNCATED' });
    const cut = formatReport(sampleReport()).slice(0, 120);
    expect(parseReport(cut)).toEqual({ ok: false, error: 'TRUNCATED' });
  });

  it('rejects a changed character as a bad checksum', () => {
    const text = formatReport(sampleReport()).replace('Kadıköy', 'Kadıkoy');
    expect(parseReport(text)).toEqual({ ok: false, error: 'BAD_CHECKSUM' });
  });

  it('rejects a removed entry whose END line was kept', () => {
    const lines = formatReport(sampleReport()).trimEnd().split('\n');
    const withoutEntry = [...lines.slice(0, -2), lines[lines.length - 1]].join('\n');
    expect(parseReport(withoutEntry)).toEqual({ ok: false, error: 'BAD_CHECKSUM' });
  });

  it('reports the line of an entry with the wrong number of fields', () => {
    const lines = validLines();
    lines.push('@ x|T|auto|pass|1|ms|2;');
    const result = parseReport(withEnd(lines));
    expect(result).toEqual({ ok: false, error: 'BAD_LINE', line: lines.length });
  });

  it('rejects unknown outcome, kind, build and escape sequences', () => {
    const base = validLines();
    const bad = [
      '@ x|T|auto|maybe||||;',
      '@ x|T|robot|pass||||;',
      '@ x|T|auto|pass|a\\qb|||;',
    ];
    bad.forEach((entry) => {
      expect(parseReport(withEnd([...base, entry]))).toMatchObject({ ok: false, error: 'BAD_LINE' });
    });
    const lines = validLines().map((l) => (l.startsWith('sdk:') ? 'sdk: 0.0.0|20261020|beta;' : l));
    expect(parseReport(withEnd(lines))).toMatchObject({ ok: false, error: 'BAD_LINE' });
  });

  it('accepts CRLF line endings and trailing spaces added by a paste', () => {
    const pasted = formatReport(sampleReport())
      .split('\n')
      .map((l) => (l ? `${l}   ` : l))
      .join('\r\n');
    expect(parseReport(pasted)).toEqual({ ok: true, report: sampleReport() });
  });

  it('keeps Turkish letters, pipes and emoji in notes', () => {
    const report = sampleReport();
    report.entries[1] = { ...report.entries[1]!, note: 'İstanbul ı|İ 😀 \\ son ' };
    const result = parseReport(formatReport(report));
    expect(result).toEqual({ ok: true, report });
  });
  it('names the line of each malformed header field', () => {
    const cases: [number, string][] = [
      [1, 'id: abc'],
      [2, 'created: 2026|10;'],
      [3, 'device: Pixel|Android;'],
      [3, 'device: Pixel|Android|many;'],
      [4, 'sdk: 0.0.0|20261020;'],
    ];
    cases.forEach(([index, replacement]) => {
      const lines = validLines();
      lines[index] = replacement;
      expect(parseReport(withEnd(lines))).toEqual({ ok: false, error: 'BAD_LINE', line: index + 1 });
    });
  });

  it('rejects an entry line without its terminator', () => {
    const lines = validLines();
    lines[5] = (lines[5] as string).slice(0, -1);
    expect(parseReport(withEnd(lines))).toMatchObject({ ok: false, error: 'BAD_LINE', line: 6 });
  });

  it('rejects an END count that disagrees with the entries', () => {
    const lines = validLines();
    const bodyText = lines.join('\n') + '\n';
    const text = `${bodyText}END 5 ${crc32(bodyText).toString(16).padStart(8, '0')}\n`;
    expect(parseReport(text)).toMatchObject({ ok: false, error: 'BAD_LINE' });
  });

  it('reads a report with no entries and no optional header values', () => {
    const report = sampleReport();
    report.entries = [];
    report.device = { model: 'Pixel', os: 'Android 16' };
    report.sdk = { version: '1.0.0', dataVersion: null, build: 'debug' };
    expect(parseReport(formatReport(report))).toEqual({ ok: true, report });
  });
  it('requires the END line to stand alone and match exactly', () => {
    const text = formatReport(sampleReport()).trimEnd();
    expect(parseReport(`${text} extra\n`)).toEqual({ ok: false, error: 'TRUNCATED' });
    expect(parseReport(text.replace(/END /, 'xEND '))).toEqual({ ok: false, error: 'TRUNCATED' });
  });

  it('rejects a memory value that is only partly numeric', () => {
    const lines = validLines().map((l) => (l.startsWith('device:') ? 'device: Pixel|Android|12abc;' : l));
    expect(parseReport(withEnd(lines))).toEqual({ ok: false, error: 'BAD_LINE', line: 4 });
  });

  it('reads reports with ten or more entries', () => {
    const report = sampleReport();
    report.entries = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, kind: 'auto' as const, outcome: 'pass' as const }));
    expect(parseReport(formatReport(report))).toEqual({ ok: true, report });
  });
});
