import type { ReportEntry } from '../../../src/core/report/types';

type Listed = { id: string; title: string; kind: 'auto' | 'manual' };

export function reportList(tests: Listed[], entries: Record<string, ReportEntry>, notes: Record<string, string>): ReportEntry[] {
  const list: ReportEntry[] = [];
  for (const test of tests) {
    const given = entries[test.id];
    const note = (notes[test.id] ?? '').trim();
    if (given) list.push(note ? { ...given, note } : given);
    else if (note) list.push({ id: test.id, title: test.title, kind: test.kind, outcome: 'skip', note });
  }
  return list;
}
