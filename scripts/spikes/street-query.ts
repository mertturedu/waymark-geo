export type Row = Record<string, string | number | null>;
export type Driver = { all(sql: string, params: (string | number)[]): Promise<Row[]> };
export type StreetHit = { id: number; name: string; fold: string; lon: number; lat: number; score: number };

const CANDIDATES = 200;
const MAX_FOLDED_LENGTH = 100;

const LETTERS: Record<string, string> = { İ: 'i', I: 'i', ı: 'i', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o', Ç: 'c', ç: 'c' };

export function fold(text: string): string {
  const mapped = text.replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => LETTERS[c] as string).toLowerCase();
  return mapped
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function trigrams(folded: string): string[] {
  if (folded === '') return [];
  const padded = ` ${folded} `;
  const seen = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) seen.add(padded.slice(i, i + 3));
  return [...seen];
}

const dice = (a: string[], b: string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(b);
  let shared = 0;
  for (const g of a) if (set.has(g)) shared++;
  return (2 * shared) / (a.length + b.length);
};

const numberTokens = (folded: string): string[] => folded.split(' ').filter((token) => /^\d+$/.test(token));

export async function searchStreets(driver: Driver, query: string, limit = 5): Promise<StreetHit[]> {
  const folded = fold(query).slice(0, MAX_FOLDED_LENGTH).trim();
  const grams = trigrams(folded);
  if (grams.length === 0) return [];
  const marks = grams.map(() => '?').join(',');
  const rows = await driver.all(
    `SELECT s.id AS id, s.name AS name, s.fold AS fold, s.lon AS lon, s.lat AS lat
     FROM (SELECT sid FROM tri WHERE t IN (${marks}) GROUP BY sid ORDER BY count(*) DESC LIMIT ${CANDIDATES}) a
     JOIN street s ON s.id = a.sid`,
    grams,
  );
  const wanted = numberTokens(folded);
  const hits: StreetHit[] = [];
  for (const row of rows) {
    const candidate = String(row.fold);
    const tokens = new Set(candidate.split(' '));
    if (!wanted.every((token) => tokens.has(token))) continue;
    hits.push({
      id: Number(row.id),
      name: String(row.name),
      fold: candidate,
      lon: Number(row.lon) / 1e6,
      lat: Number(row.lat) / 1e6,
      score: dice(grams, trigrams(candidate)),
    });
  }
  return hits.sort((x, y) => y.score - x.score || x.id - y.id).slice(0, limit);
}
