import type { Outcome, ReportEntry } from '../../../src/core';

export type Saved = { outcome: Outcome; rev: number; note?: string };
export type Memory = { answers: Record<string, Saved>; notes: Record<string, string> };
type Question = { id: string; title: string; kind: 'auto' | 'manual'; rev?: number };

const OUTCOMES: readonly string[] = ['pass', 'fail', 'skip', 'info'];
const revOf = (question: { rev?: number }): number => question.rev ?? 1;

export const encodeMemory = (memory: Memory): string => JSON.stringify(memory);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function decodeMemory(text: string): Memory {
  const out: Memory = { answers: {}, notes: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed)) return out;
    if (isObject(parsed.answers)) {
      for (const [id, value] of Object.entries(parsed.answers)) {
        if (!isObject(value) || typeof value.outcome !== 'string' || !OUTCOMES.includes(value.outcome) || typeof value.rev !== 'number') continue;
        out.answers[id] = { outcome: value.outcome as Outcome, rev: value.rev, ...(typeof value.note === 'string' && value.note !== '' ? { note: value.note } : {}) };
      }
    }
    if (isObject(parsed.notes)) for (const [id, value] of Object.entries(parsed.notes)) if (typeof value === 'string') out.notes[id] = value;
  } catch {
    return out;
  }
  return out;
}

export function importOldEntries(text: string): Memory {
  const out: Memory = { answers: {}, notes: {} };
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isObject(parsed) || !isObject(parsed.entries)) return out;
    for (const [id, value] of Object.entries(parsed.entries)) {
      if (!isObject(value) || value.kind !== 'manual' || typeof value.outcome !== 'string' || !OUTCOMES.includes(value.outcome)) continue;
      out.answers[id] = { outcome: value.outcome as Outcome, rev: 1, ...(typeof value.note === 'string' && value.note !== '' ? { note: value.note } : {}) };
    }
  } catch {
    return out;
  }
  return out;
}

export const isSettled = (question: { id: string; rev?: number }, memory: Memory): boolean => {
  const saved = memory.answers[question.id];
  return saved !== undefined && saved.outcome === 'pass' && saved.rev === revOf(question);
};

export function carriedEntries(questions: Question[], memory: Memory, entries: Record<string, ReportEntry>): Record<string, ReportEntry> {
  const out: Record<string, ReportEntry> = {};
  for (const question of questions) {
    if (entries[question.id] || !isSettled(question, memory)) continue;
    out[question.id] = { id: question.id, title: question.title, kind: question.kind, outcome: 'pass', note: 'önceki derlemede geçti' };
  }
  return out;
}
