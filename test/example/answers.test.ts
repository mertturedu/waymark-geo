import { carriedEntries, decodeMemory, encodeMemory, importOldEntries, isSettled, type Memory } from '../../example/src/sdk-test/answers';

const q = (id: string, rev = 1) => ({ id, title: `başlık ${id}`, kind: 'manual' as const, rev });
const empty = (): Memory => ({ answers: {}, notes: {} });

describe('memory of answers', () => {
  it('round trips answers and notes', () => {
    const memory: Memory = { answers: { 'sdk.q-a': { outcome: 'pass', rev: 1 }, 'sdk.q-b': { outcome: 'fail', rev: 2, note: 'olmadı' } }, notes: { 'sdk.q-c': 'yazdım' } };
    expect(decodeMemory(encodeMemory(memory))).toEqual(memory);
  });

  it('survives garbage and keeps only well formed answers', () => {
    expect(decodeMemory('')).toEqual(empty());
    expect(decodeMemory('{')).toEqual(empty());
    expect(decodeMemory('[]')).toEqual(empty());
    const mixed = JSON.stringify({ answers: { good: { outcome: 'pass', rev: 1 }, bad: { outcome: 'maybe', rev: 1 }, worse: 5 }, notes: { a: 'x', b: 7 } });
    expect(decodeMemory(mixed)).toEqual({ answers: { good: { outcome: 'pass', rev: 1 } }, notes: { a: 'x' } });
  });
});

describe('isSettled', () => {
  const memory: Memory = { answers: { 'sdk.q-a': { outcome: 'pass', rev: 1 }, 'sdk.q-b': { outcome: 'fail', rev: 1 } }, notes: {} };
  it('settles a question that passed in the same revision', () => {
    expect(isSettled(q('sdk.q-a'), memory)).toBe(true);
  });
  it('asks again after a revision change, a failure or no answer', () => {
    expect(isSettled(q('sdk.q-a', 2), memory)).toBe(false);
    expect(isSettled(q('sdk.q-b'), memory)).toBe(false);
    expect(isSettled(q('sdk.q-c'), memory)).toBe(false);
  });
});

describe('importOldEntries', () => {
  it('takes passed questions from the file of an older build and ignores the rest', () => {
    const old = JSON.stringify({
      buildId: 'eski',
      entries: {
        'sdk.q-a': { id: 'sdk.q-a', title: 'a', kind: 'manual', outcome: 'pass' },
        'sdk.q-b': { id: 'sdk.q-b', title: 'b', kind: 'manual', outcome: 'fail', note: 'olmadı' },
        'sdk.region-detect': { id: 'sdk.region-detect', title: 'oto', kind: 'auto', outcome: 'pass' },
      },
    });
    expect(importOldEntries(old)).toEqual({ answers: { 'sdk.q-a': { outcome: 'pass', rev: 1 }, 'sdk.q-b': { outcome: 'fail', rev: 1, note: 'olmadı' } }, notes: {} });
  });
  it('gives an empty memory for garbage', () => {
    expect(importOldEntries('{')).toEqual(empty());
    expect(importOldEntries('null')).toEqual(empty());
  });
});

describe('carriedEntries', () => {
  it('reports settled questions that were not answered in this session', () => {
    const memory: Memory = { answers: { 'sdk.q-a': { outcome: 'pass', rev: 1 } }, notes: {} };
    expect(carriedEntries([q('sdk.q-a'), q('sdk.q-b')], memory, {})).toEqual({ 'sdk.q-a': { id: 'sdk.q-a', title: 'başlık sdk.q-a', kind: 'manual', outcome: 'pass', note: 'önceki derlemede geçti' } });
  });
  it('leaves out a question answered again in this session and one whose revision changed', () => {
    const memory: Memory = { answers: { 'sdk.q-a': { outcome: 'pass', rev: 1 }, 'sdk.q-b': { outcome: 'pass', rev: 1 } }, notes: {} };
    const now = { 'sdk.q-a': { id: 'sdk.q-a', title: 'a', kind: 'manual' as const, outcome: 'pass' as const } };
    expect(Object.keys(carriedEntries([q('sdk.q-a'), q('sdk.q-b', 2)], memory, now))).toEqual([]);
  });
});
