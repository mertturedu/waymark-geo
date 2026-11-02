import { reportList } from '../../example/src/device-test/report-list';
import type { ReportEntry } from '../../src/core/report/types';

const test = (id: string) => ({ id, title: `başlık ${id}`, kind: 'manual' as const });
const entry = (id: string, outcome: ReportEntry['outcome'], note?: string): ReportEntry => ({ id, title: `başlık ${id}`, kind: 'manual', outcome, ...(note ? { note } : {}) });

describe('reportList', () => {
  it('keeps answered entries as they are when no note was typed', () => {
    expect(reportList([test('a')], { a: entry('a', 'pass') }, {})).toEqual([entry('a', 'pass')]);
  });

  it('writes a note typed after the answer into the answered entry', () => {
    expect(reportList([test('a')], { a: entry('a', 'pass') }, { a: 'harita geç açıldı' })).toEqual([entry('a', 'pass', 'harita geç açıldı')]);
  });

  it('replaces an older note with the one in the box', () => {
    expect(reportList([test('a')], { a: entry('a', 'fail', 'eski') }, { a: 'yeni' })).toEqual([entry('a', 'fail', 'yeni')]);
  });

  it('adds a skipped entry for a question that only has a note', () => {
    expect(reportList([test('a')], {}, { a: 'arama kutusu klavyenin altında kaldı' })).toEqual([{ id: 'a', title: 'başlık a', kind: 'manual', outcome: 'skip', note: 'arama kutusu klavyenin altında kaldı' }]);
  });

  it('leaves out a test with neither an answer nor a note, and ignores blank notes', () => {
    expect(reportList([test('a'), test('b')], { b: entry('b', 'pass') }, { a: '   ' })).toEqual([entry('b', 'pass')]);
  });

  it('keeps the order of the tests', () => {
    expect(reportList([test('b'), test('a')], { a: entry('a', 'pass'), b: entry('b', 'pass') }, {}).map((e) => e.id)).toEqual(['b', 'a']);
  });
});
