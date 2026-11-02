import { formatReport } from '../../src/core/report/format';
import { crc32 } from '../../src/core/report/crc32';
import { sampleReport } from './fixtures';

describe('formatReport', () => {
  it('starts with the version header and ends with a checksummed END line', () => {
    const lines = formatReport(sampleReport()).trimEnd().split('\n');
    expect(lines[0]).toBe('YUKSI-GEO-REPORT v1');
    const end = lines[lines.length - 1] as string;
    expect(end).toMatch(/^END 2 [0-9a-f]{8}$/);
    const body = lines.slice(0, -1).join('\n') + '\n';
    expect(end).toBe(`END 2 ${crc32(body).toString(16).padStart(8, '0')}`);
  });

  it('escapes pipes, backslashes and line breaks in free text', () => {
    const report = sampleReport();
    report.entries[0] = { ...report.entries[0]!, note: 'a|b\nc\\d' };
    const entryLine = formatReport(report).split('\n').find((l) => l.startsWith('@ env.info')) as string;
    expect(entryLine).toContain('a\\|b\\nc\\\\d');
  });

  it('writes one line per entry and every free-text line ends with a terminator', () => {
    const lines = formatReport(sampleReport()).trimEnd().split('\n');
    const freeText = lines.filter((l) => /^(id|created|device|sdk):|^@ /.test(l));
    expect(freeText).toHaveLength(6);
    freeText.forEach((l) => expect(l.endsWith(';')).toBe(true));
  });

  it('writes an empty field for missing optional values', () => {
    const report = sampleReport();
    report.device = { model: 'Pixel', os: 'Android 16' };
    report.sdk = { version: '0.0.0', dataVersion: null, build: 'debug' };
    const text = formatReport(report);
    expect(text).toContain('device: Pixel|Android 16|;');
    expect(text).toContain('sdk: 0.0.0||debug;');
  });
});
