import { formatBytes } from '../../src/native/logic/size';

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('formatBytes', () => {
  it('shows megabytes without decimals from ten megabytes up', () => {
    expect(formatBytes(312 * MB)).toBe('312 MB');
    expect(formatBytes(10 * MB)).toBe('10 MB');
    expect(formatBytes(50.4 * MB)).toBe('50 MB');
    expect(formatBytes(999 * MB)).toBe('999 MB');
  });

  it('keeps one decimal below ten megabytes and drops a trailing zero', () => {
    expect(formatBytes(2.5 * MB, 'en')).toBe('2.5 MB');
    expect(formatBytes(2.5 * MB, 'tr')).toBe('2,5 MB');
    expect(formatBytes(3 * MB, 'tr')).toBe('3 MB');
    expect(formatBytes(100_000)).toBe('0,1 MB');
  });

  it('switches to gigabytes from 1 GB, with the language decimal sign', () => {
    expect(formatBytes(1.2 * GB, 'tr')).toBe('1,2 GB');
    expect(formatBytes(1.2 * GB, 'en')).toBe('1.2 GB');
    expect(formatBytes(1.2 * GB, 'ar')).toBe('1.2 GB');
    expect(formatBytes(GB, 'de')).toBe('1 GB');
    expect(formatBytes(1024 * MB - 1)).toBe('1024 MB');
  });

  it('never shows nonsense', () => {
    for (const value of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatBytes(value)).toBe('0 MB');
  });
});
