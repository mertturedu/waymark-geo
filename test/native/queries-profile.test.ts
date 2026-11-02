import { foldTurkish, speedQueries } from '../../src/native/logic/queries';
import { profileDb, summarizeProfile } from '../../src/native/logic/profile';
import type { SqlDb } from '../../src/core/ports';

const pool = Array.from({ length: 10 }, (_, i) => ({ text: `Çiçek Sokağı No:${i} Şişli İstanbul`, id: `q${i}` }));

describe('foldTurkish', () => {
  it('replaces Turkish letters with their plain Latin forms', () => {
    expect(foldTurkish('Çiğdem Sokağı İşçi Ömer Ürgüp Iğdır ışık')).toBe('Cigdem Sokagi Isci Omer Urgup Igdir isik');
    expect(foldTurkish('abc 123')).toBe('abc 123');
  });
});

describe('speedQueries', () => {
  it('keeps the golden queries first and in order', () => {
    const out = speedQueries(pool, 4);
    expect(out.map((q) => q.id)).toEqual(['q0', 'q1', 'q2', 'q3']);
    expect(out.every((q) => q.variant === 'golden')).toBe(true);
  });

  it('fills up to the count with folded and abbreviated variants of the same entries', () => {
    const out = speedQueries(pool, 25);
    expect(out).toHaveLength(25);
    expect(out.slice(0, 10).every((q) => q.variant === 'golden')).toBe(true);
    const extra = out.slice(10);
    expect(new Set(extra.map((q) => q.variant))).toEqual(new Set(['folded', 'abbreviated']));
    extra.forEach((q, i) => expect(q.id).toBe(`q${(i + 0) % 10}`));
    for (const q of extra) if (q.variant === 'folded') expect(q.text).toBe(foldTurkish(pool[Number(q.id.slice(1))]?.text ?? ''));
  });

  it('turns street and neighbourhood words into the short forms people type', () => {
    const [folded, abbreviated] = speedQueries([{ text: 'Gül Caddesi No:3 Moda Mahallesi Kadıköy Sokağı' }], 3).slice(1);
    expect(folded?.text).toBe('Gul Caddesi No:3 Moda Mahallesi Kadikoy Sokagi');
    expect(abbreviated?.text).toBe('Gül Cd. No:3 Moda Mah. Kadıköy Sk.');
  });

  it('is the same every time and never returns more than asked', () => {
    expect(speedQueries(pool, 37)).toEqual(speedQueries(pool, 37));
    expect(speedQueries(pool, 0)).toEqual([]);
    expect(speedQueries([], 5)).toEqual([]);
    expect(speedQueries(pool, 3)).toHaveLength(3);
  });
});

describe('profileDb', () => {
  const fake = (): SqlDb => ({ all: async <T>() => [1, 2] as unknown as T[], close: async () => undefined });

  it('counts calls and adds up the time spent waiting for the database', async () => {
    let time = 0;
    const profile = profileDb(() => time);
    const db = profile.wrap({ all: async <T>() => ((time += 7), [1] as unknown as T[]), close: async () => undefined });
    await db.all('SELECT 1');
    await db.all('SELECT 2', [1]);
    expect(profile.stats()).toEqual({ calls: 2, ms: 14, rows: 2 });
  });

  it('can be reset between runs and does not change what the database returns', async () => {
    const profile = profileDb(() => 0);
    const db = profile.wrap(fake());
    expect(await db.all('SELECT 1')).toEqual([1, 2]);
    profile.reset();
    expect(profile.stats()).toEqual({ calls: 0, ms: 0, rows: 0 });
    await db.close();
  });

  it('counts a call that fails and lets the error through', async () => {
    let time = 0;
    const profile = profileDb(() => time);
    const db = profile.wrap({ all: async () => { time += 3; throw new Error('bad'); }, close: async () => undefined });
    await expect(db.all('SELECT')).rejects.toThrow('bad');
    expect(profile.stats()).toMatchObject({ calls: 1, ms: 3 });
  });
});

describe('summarizeProfile', () => {
  it('turns totals into per question numbers', () => {
    expect(summarizeProfile({ calls: 1000, ms: 8000, rows: 5000 }, 500, 20000)).toEqual({ callsPerQuery: 2, sqlMsPerQuery: 16, otherMsPerQuery: 24, rowsPerQuery: 10 });
    expect(summarizeProfile({ calls: 0, ms: 0, rows: 0 }, 0, 0)).toEqual({ callsPerQuery: 0, sqlMsPerQuery: 0, otherMsPerQuery: 0, rowsPerQuery: 0 });
  });
});
