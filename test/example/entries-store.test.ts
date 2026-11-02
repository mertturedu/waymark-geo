import { decodeEntries, encodeEntries } from '../../example/src/device-test/entries-store';
import type { ReportEntry } from '../../src/core';

const entry: ReportEntry = { id: 'd1.net-state', title: 'ağ', kind: 'auto', outcome: 'pass' };

describe('entries store', () => {
  it('round trips the entries of the same build', () => {
    expect(decodeEntries(encodeEntries('release-1', { [entry.id]: entry }), 'release-1')).toEqual({ [entry.id]: entry });
  });

  it('drops entries saved by another build', () => {
    expect(decodeEntries(encodeEntries('debug-1', { [entry.id]: entry }), 'release-1')).toEqual({});
  });

  it('drops the old format that carried no build tag', () => {
    expect(decodeEntries(JSON.stringify({ [entry.id]: entry }), 'release-1')).toEqual({});
  });

  it('survives garbage', () => {
    expect(decodeEntries('', 'a')).toEqual({});
    expect(decodeEntries('{', 'a')).toEqual({});
    expect(decodeEntries('null', 'a')).toEqual({});
    expect(decodeEntries('[]', 'a')).toEqual({});
  });
});
