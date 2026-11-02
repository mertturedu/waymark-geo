import type { StreetKey } from '../text/street';

export type NameScore = { score: number; exact: boolean };

export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j]! + 1, row[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, beforePrevious[j - 2]! + 1);
      row.push(value);
      smallest = Math.min(smallest, value);
    }
    if (smallest > max) return max + 1;
    beforePrevious = previous;
    previous = row;
  }
  return Math.min(previous[b.length]!, max + 1);
}

const KIND_PENALTY = 0.97;
const NUMBER_KIND_PENALTY = 0.9;

export function kindFactor(asked: string | null, found: string | null, numberOnly: boolean): number {
  if (asked === null || found === null || asked === found) return 1;
  return numberOnly ? NUMBER_KIND_PENALTY : KIND_PENALTY;
}

function typoScore(distance: number, shortest: number): number {
  if (distance === 1) return shortest >= 6 ? 0.88 : shortest >= 4 ? 0.7 : 0.5;
  if (distance === 2) return shortest >= 9 ? 0.72 : shortest >= 6 ? 0.6 : 0;
  return 0;
}

export function nameScore(query: StreetKey, candidate: StreetKey): NameScore {
  if (query.key === '' || candidate.key === '') return { score: 0, exact: false };
  if (query.numbers.join(',') !== candidate.numbers.join(',')) return { score: 0, exact: false };
  const penalty = kindFactor(query.kind, candidate.kind, query.numberOnly && candidate.numberOnly);
  const exact = query.key === candidate.key;
  let base = 0;
  if (exact) base = 1;
  else if (query.compact === candidate.compact) base = 0.98;
  else if (query.bare.key === candidate.bare.key || query.bare.compact === candidate.bare.compact) base = 0.96;
  else if (query.loose === candidate.loose || query.bare.loose === candidate.bare.loose) base = 0.94;
  else {
    const shortest = Math.min(query.compact.length, candidate.compact.length);
    const distance = Math.min(editDistance(query.compact, candidate.compact, 2), editDistance(query.loose, candidate.loose, 2));
    base = typoScore(distance, shortest);
  }
  return { score: base * penalty, exact };
}
