import { findDistrict, findProvince, provinceByPlate } from './admin';
import { numberWordsToDigits } from './digits';
import { truncateInput } from './fold';
import { LANGS, isPoiWord, lookupWords } from './lexicon';
import { streetKey } from './street';
import { tokenize, type Token } from './tokenize';
import { scriptOf } from './translit';
import type { AdminMatch, Lang, ParsedAddress, ParsedStreet, WordKind } from './types';

type Role = 'street' | 'hood' | 'no' | 'door' | 'floor' | 'block' | 'site' | 'building';

const ROLE: Record<WordKind, Role> = {
  sokak: 'street', cadde: 'street', bulvar: 'street', yol: 'street', cikmaz: 'street', meydan: 'street',
  mahalle: 'hood', numara: 'no', daire: 'door', kat: 'floor', blok: 'block', site: 'site', bina: 'building',
};

const ADMIN_WORDS = new Set(['il', 'ili', 'ilce', 'ilcesi', 'province', 'district', 'rayon', 'bezirk']);
const COMMON_DISTRICTS = new Set(['fatih', 'yildirim', 'selcuk', 'celebi']);
const FLOOR_WORDS = new Set(['bodrum', 'zemin', 'cati']);
const MAX_SPAN = 8;
const GERMAN_ENDINGS: [string, string][] = [['strasse', 'strasse'], ['gasse', 'gasse'], ['allee', 'allee'], ['weg', 'weg'], ['platz', 'platz']];
const NUM = /^\d+[a-z]?(?:[/-][a-z0-9]+)*$/;
const DIGITS = /^\d+$/;
const GLUED_AFTER = /^([a-z]+)(\d[a-z0-9/-]*)$/;
const GLUED_BEFORE = /^(\d+)([a-z]{2,})$/;
const BLOCK_NAME = /^[a-z]\d{1,2}$/;
const VALUE_ROLES: ReadonlySet<Role> = new Set(['no', 'door', 'floor', 'block']);

const streetNumberLike = (token: Token | undefined): boolean => !!token && NUM.test(token.t) && (token.t.length >= 4 || /[/-]/.test(token.t));

const empty = (input: string): ParsedAddress => ({
  input, language: null, province: null, district: null, neighbourhood: null, street: null, secondStreet: null, houseNumber: null,
  building: null, block: null, floor: null, door: null, poiName: null, postcode: null, leftover: [],
});

const SCRIPT_LANG: Partial<Record<ReturnType<typeof scriptOf>, Lang>> = { cyrillic: 'ru', greek: 'el', arabic: 'ar' };
const MARKER_FIRST: ReadonlySet<Lang> = new Set(['ru', 'el', 'ar']);

function detectLanguage(tokens: Token[], script: ReturnType<typeof scriptOf>): Lang | null {
  const counts = new Map<Lang, number>();
  for (const { t } of tokens) {
    const seen = new Set<Lang>();
    for (const hit of lookupWords(t)) seen.add(hit.lang);
    for (const lang of seen) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const fromScript = SCRIPT_LANG[script] ?? null;
  let best: Lang | null = null;
  for (const lang of LANGS) {
    const count = counts.get(lang) ?? 0;
    const top = counts.get(best as Lang) ?? 0;
    if (count > top || (count === top && count > 0 && lang === fromScript)) best = lang;
  }
  return best ?? fromScript;
}

function convertNumberWords(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let start = 0;
  while (start < tokens.length) {
    let end = start;
    while (end < tokens.length && tokens[end]?.seg === tokens[start]?.seg) end++;
    const segment = tokens.slice(start, end);
    const pieces = numberWordsToDigits(segment.map((token) => token.t).join(' ')).split(' ');
    const same = pieces.length === segment.length;
    pieces.forEach((piece, i) => out.push({ t: piece, seg: (segment[0] as Token).seg, dotted: same ? (segment[i] as Token).dotted : false }));
    start = end;
  }
  return out;
}

export function parseAddress(text: string): ParsedAddress {
  const input = truncateInput(text);
  const result = empty(input);
  let tokens = tokenize(input);
  if (tokens.length === 0) return result;

  const script = scriptOf(input);
  const preliminary = detectLanguage(tokens, script);
  const allowedFor = (lang: Lang | null): readonly Lang[] => (lang === null ? LANGS : lang === 'tr' ? ['tr'] : [lang, 'tr']);
  const kindIn = (t: string, allowed: readonly Lang[]): WordKind | null => {
    const hits = lookupWords(t);
    for (const lang of allowed) {
      const hit = hits.find((candidate) => candidate.lang === lang);
      if (hit) return hit.kind;
    }
    return null;
  };
  const kindOf = (t: string): WordKind | null => kindIn(t, allowedFor(preliminary));

  tokens = tokens.flatMap((token): Token[] => {
    const after = GLUED_AFTER.exec(token.t);
    const before = GLUED_BEFORE.exec(token.t);
    const wordKind = (word: string) => kindOf(word);
    if (after && ['numara', 'daire', 'kat', 'blok'].includes(wordKind(after[1] as string) ?? '')) {
      return [{ ...token, t: after[1] as string, dotted: false }, { ...token, t: after[2] as string }];
    }
    if (before && ['kat', 'daire', 'blok'].includes(wordKind(before[2] as string) ?? '')) {
      return [{ ...token, t: before[1] as string, dotted: true }, { ...token, t: before[2] as string, dotted: false }];
    }
    return [token];
  });

  tokens = tokens.flatMap((token): Token[] => {
    const ending = lookupWords(token.t).length > 0 ? undefined : GERMAN_ENDINGS.find(([suffix]) => token.t.endsWith(suffix) && token.t.length >= suffix.length + 3);
    if (!ending) return [token];
    return [{ ...token, t: token.t.slice(0, token.t.length - ending[0].length) }, { ...token, t: ending[1], dotted: false }];
  });
  tokens = convertNumberWords(tokens);
  tokens = tokens.filter((token, i) => !(token.t === 'nolu' && NUM.test(tokens[i - 1]?.t ?? '') && token.seg === tokens[i - 1]?.seg && (ROLE[kindOf(tokens[i + 1]?.t ?? '') as WordKind] === 'street' || (kindOf(tokens[i + 1]?.t ?? '') === null && !NUM.test(tokens[i + 1]?.t ?? '') && ROLE[kindOf(tokens[i + 2]?.t ?? '') as WordKind] === 'no' && token.seg === tokens[i + 2]?.seg)) && token.seg === tokens[i + 1]?.seg));

  const language = detectLanguage(tokens, script);
  result.language = language;
  const allowed = allowedFor(language);
  const n = tokens.length;
  const used = new Array<boolean>(n).fill(false);
  const plain = new Set<number>();
  const rawRole = (i: number): Role | null => {
    const t = tokens[i]?.t;
    if (t === undefined) return null;
    const kind = kindIn(t, allowed);
    return kind ? ROLE[kind] : null;
  };
  const roleAt = (i: number): Role | null => (plain.has(i) ? null : rawRole(i));
  const same = (i: number, j: number) => tokens[i] !== undefined && tokens[j] !== undefined && tokens[i]?.seg === tokens[j]?.seg;
  const free = (i: number, from: number) => i >= 0 && i < n && !used[i] && same(i, from);
  const isNumber = (i: number) => NUM.test(tokens[i]?.t ?? '');
  const markerFirst = language !== null && MARKER_FIRST.has(language);
  for (let i = 0; i < n; i++) {
    const role = rawRole(i);
    const neighbour = markerFirst ? i - 1 : i + 1;
    if ((role === 'street' || role === 'hood') && rawRole(neighbour) === role && same(i, neighbour)) plain.add(i);
    if ((role === 'building' || role === 'site') && rawRole(i + 1) === 'street' && same(i, i + 1)) plain.add(i);
    if (role === 'no' && tokens[i]?.t === 'kapi' && rawRole(i + 1) === 'street' && same(i, i + 1)) plain.add(i);
    if (!markerFirst && role === 'street' && rawRole(i + 1) === 'hood' && same(i, i + 1)) plain.add(i);
  }

  const postcodeAt = tokens.findIndex((token, i) => {
    const plate = Number(token.t.slice(0, 2));
    const neighbour = roleAt(i + 1);
    return /^\d{5}$/.test(token.t) && plate >= 1 && plate <= 81 && !token.dotted && neighbour !== 'street' && neighbour !== 'hood' && roleAt(i - 1) !== 'no' && (!markerFirst || (roleAt(i - 1) !== 'street' && roleAt(i - 1) !== 'hood'));
  });
  if (postcodeAt >= 0) {
    result.postcode = tokens[postcodeAt]?.t ?? null;
    used[postcodeAt] = true;
  }

  const take = (i: number): string => {
    used[i] = true;
    return tokens[i]?.t ?? '';
  };

  const doorPrefix = (i: number): { inner: boolean; at: number } | null => {
    const at = tokens[i - 1]?.t === 'kapi' && same(i - 1, i) ? i - 2 : i - 1;
    const word = tokens[at]?.t;
    return (word === 'ic' || word === 'dis') && same(at, i) && !used[at] ? { inner: word === 'ic', at } : null;
  };

  for (let i = 0; i < n; i++) {
    const role = used[i] ? null : roleAt(i);
    if (role === null || !VALUE_ROLES.has(role)) continue;
    const single = (tokens[i]?.t.length ?? 0) === 1;
    const numeric = (j: number) => free(j, i) && isNumber(j);
    const markerLetter = (j: number) => /^[a-z]$/.test(tokens[j]?.t ?? '') && roleAt(j) !== null && !(free(j + 1, j) && isNumber(j + 1));
    const letterOk = (j: number) => free(j, i) && ((roleAt(j) === null && (isNumber(j) || /^[a-z]$/.test(tokens[j]?.t ?? '') || BLOCK_NAME.test(tokens[j]?.t ?? ''))) || markerLetter(j));
    const ok = role === 'block' ? letterOk : numeric;
    const skipNo = (role === 'door' || role === 'floor') && roleAt(i + 1) === 'no' && same(i, i + 1);
    const next = skipNo ? i + 2 : i + 1;
    const nextIsStreet = roleAt(i + 1) === 'street' && same(i, i + 1);
    const nextBeforeStreet = ok(next) && roleAt(next + 1) === 'street' && same(next, next + 1);
    let value = -1;
    if (role === 'floor') {
      const before = (numeric(i - 1) && !nextBeforeStreet) || (free(i - 1, i) && FLOOR_WORDS.has(tokens[i - 1]?.t ?? ''));
      if (ok(next) && single) value = next;
      else if (before && tokens[i - 1]?.dotted) value = i - 1;
      else value = ok(next) ? next : before ? i - 1 : -1;
    }
    else if (role === 'no' && nextIsStreet) value = -2;
    else if (ok(next) && !nextBeforeStreet) value = next;
    else if (ok(i - 1) && (role !== 'door' || !single)) value = i - 1;
    if (value === -1 && single) continue;
    used[i] = true;
    if (value < 0) continue;
    if (value === next && skipNo) used[i + 1] = true;
    const text = take(value);
    if (role === 'no') {
      const prefix = doorPrefix(i);
      if (prefix) used[prefix.at] = true;
      if (prefix?.inner) result.door ??= text;
      else result.houseNumber ??= text;
    }
    else if (role === 'door') result.door ??= text;
    else if (role === 'floor') result.floor ??= text;
    else result.block ??= text;
  }

  type Match = { from: number; to: number; province: AdminMatch | null; districts: AdminMatch[] };
  const matches: Match[] = [];
  const sideMarker = (i: number) => {
    const r = rawRole(i);
    return r === 'street' || r === 'hood' || r === 'floor' || r === 'building' || r === 'site' || r === 'block';
  };
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    for (let size = 3; size >= 1; size--) {
      const last = i + size - 1;
      if (last >= n || !same(i, last)) continue;
      if (tokens.slice(i, last + 1).some((_, k) => used[i + k])) continue;
      const excluded = markerFirst ? sideMarker(i - 1) && same(i - 1, i) : sideMarker(last + 1) && same(last, last + 1);
      if (excluded) continue;
      const key = tokens.slice(i, last + 1).map((token) => token.t).join(' ');
      const province = findProvince(key);
      const districts = findDistrict(key);
      if (!province && districts.length === 0) continue;
      matches.push({ from: i, to: last, province, districts });
      i = last;
      break;
    }
  }
  const matched = new Set<number>();
  for (const m of matches) for (let j = m.from; j <= m.to; j++) matched.add(j);
  const word = (j: number, from: number) => j >= 0 && j < n && same(j, from) && roleAt(j) === null && !isNumber(j) && !matched.has(j);
  const weight = (m: Match): number => {
    const before = word(m.from - 1, m.from);
    const after = word(m.to + 1, m.to);
    return (!after ? 2 : 0) + (!before ? 1 : 0) + (m.districts.length === 1 ? 1 : 0);
  };
  const provinceMatches = matches.filter((m) => m.province !== null);
  const afterProvince = (m: Match) => provinceMatches.some((p) => p.to === m.from - 1);
  const looksLikeName = (m: Match) => COMMON_DISTRICTS.has(tokens.slice(m.from, m.to + 1).map((token) => token.t).join(' ')) && word(m.to + 1, m.to) && !afterProvince(m);
  const districtMatches = matches.filter((m) => m.districts.length > 0 && !looksLikeName(m));
  let provinceMatch: Match | undefined = provinceMatches[0];
  let districtMatch: Match | undefined;
  let bestWeight = -1;
  for (const p of provinceMatches) {
    for (const d of districtMatches) {
      if (d === p || !d.districts.some((candidate) => candidate.plate === p.province?.plate)) continue;
      if (weight(d) >= bestWeight) {
        bestWeight = weight(d);
        provinceMatch = p;
        districtMatch = d;
      }
    }
  }
  result.province = provinceMatch?.province ?? null;
  if (!districtMatch) {
    for (const d of districtMatches) {
      if (d === provinceMatch || (result.province && !d.districts.some((candidate) => candidate.plate === result.province?.plate))) continue;
      if (weight(d) >= bestWeight) {
        bestWeight = weight(d);
        districtMatch = d;
      }
    }
  }
  const chosen: Match[] = [provinceMatch, districtMatch].filter((m): m is Match => m !== undefined);
  if (districtMatch) {
    const narrowed = districtMatch.districts.filter((d) => !result.province || d.plate === result.province.plate);
    result.district = { ...(narrowed[0] as AdminMatch), ambiguous: narrowed.length > 1 };
    if (!result.province && narrowed.length === 1) result.province = provinceByPlate(narrowed[0]?.plate ?? '');
  }
  for (const m of chosen) {
    for (let j = m.from; j <= m.to; j++) used[j] = true;
    if (ADMIN_WORDS.has(tokens[m.to + 1]?.t ?? '') && free(m.to + 1, m.to)) used[m.to + 1] = true;
    if (ADMIN_WORDS.has(tokens[m.from - 1]?.t ?? '') && free(m.from - 1, m.from)) used[m.from - 1] = true;
  }

  const spanBefore = (marker: number): number[] => {
    const span: number[] = [];
    for (let j = marker - 1; j >= 0 && span.length < MAX_SPAN && free(j, marker) && roleAt(j) === null; j--) span.unshift(j);
    return span;
  };
  const spanAfter = (marker: number): number[] => {
    const span: number[] = [];
    const isHood = rawRole(marker) === 'hood';
    for (let j = marker + 1; j < n && span.length < MAX_SPAN && free(j, marker) && roleAt(j) === null; j++) {
      if (isNumber(j) && span.length > 0 && span.every(isNumber)) break;
      const continues = (isHood && tokens[j]?.dotted && free(j + 1, j) && roleAt(j + 1) === null && !isNumber(j + 1)) || (!isHood && ((free(j + 1, j) && isNumber(j + 1)) || result.houseNumber !== null));
      if (isNumber(j) && span.some((k) => !isNumber(k)) && !continues) break;
      span.push(j);
    }
    return span;
  };
  const nameSpan = (marker: number): number[] => {
    const first = markerFirst ? spanAfter(marker) : spanBefore(marker);
    return first.length > 0 ? first : markerFirst ? spanBefore(marker) : spanAfter(marker);
  };

  let streetStart = -1;
  for (let i = 0; i < n; i++) {
    if (used[i] || roleAt(i) !== 'hood') continue;
    const span = nameSpan(i);
    used[i] = true;
    if (span.length === 0) continue;
    const text = span.map(take).join(' ');
    result.neighbourhood ??= text;
  }

  for (let i = 0; i < n; i++) {
    if (used[i] || roleAt(i) !== 'street' || result.secondStreet) continue;
    const isSecond = result.street !== null;
    let span = !markerFirst && free(i - 1, i) && streetNumberLike(tokens[i - 1]) ? [i - 1] : markerFirst && free(i + 1, i) && streetNumberLike(tokens[i + 1]) ? [i + 1] : nameSpan(i);
    used[i] = true;
    if (span.length === 0) continue;
    const kind = kindIn(tokens[i]?.t ?? '', allowed);
    const leading = span[0] as number;
    if (span.length > 1 && !tokens[leading]?.dotted && isNumber(leading) && language === 'en' && !result.houseNumber) {
      result.houseNumber = take(leading);
      span = span.slice(1);
    }
    if (!isSecond) streetStart = span[0] as number;
    const text = span.map(take).join(' ');
    const marker = tokens[i]?.t ?? '';
    const key = streetKey(markerFirst ? `${marker} ${text}` : `${text} ${marker}`);
    const street = { text, key: key.key, compact: key.compact, kind, number: key.number } satisfies ParsedStreet;
    if (isSecond) result.secondStreet = street;
    else result.street = street;
    const after = markerFirst ? (span[span.length - 1] as number) + 1 : i + 1;
    if (!result.houseNumber && free(after, i) && isNumber(after) && roleAt(after) === null) result.houseNumber = take(after);
  }

  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    const role = roleAt(i);
    if (role !== 'building' && role !== 'site') continue;
    const span = spanBefore(i);
    used[i] = true;
    if (span.length > 0) {
      const text = span.map(take).join(' ');
      if (role === 'building' || !result.building) result.building = result.building && role === 'site' ? result.building : text;
    }
  }

  for (let i = 0; i < n && !result.street; i++) {
    if (used[i] || !isPoiWord(tokens[i]?.t ?? '') || roleAt(i) !== null) continue;
    const span = spanBefore(i).slice(-2);
    result.poiName ??= [...span.map(take), take(i)].join(' ');
  }

  if (!result.houseNumber) {
    for (let i = n - 1; i >= 0; i--) {
      if (!used[i] && isNumber(i)) {
        result.houseNumber = take(i);
        break;
      }
    }
  }

  const runs: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (used[i] || roleAt(i) !== null) continue;
    const run = runs[runs.length - 1];
    if (run && tokens[run[run.length - 1] as number]?.seg === tokens[i]?.seg && (run[run.length - 1] as number) === i - 1) run.push(i);
    else runs.push([i]);
  }
  const wordRuns = runs.filter((run) => !run.every(isNumber));
  const claim = (run: number[]) => run.map(take).join(' ');
  if (result.street && streetStart >= 0) {
    const numbered = result.street.number !== null || DIGITS.test(result.street.key.split(' ')[0] ?? '');
    const before = wordRuns.filter((run) => (run[0] as number) < streetStart && (tokens[run[0] as number]?.seg !== tokens[streetStart]?.seg || (numbered && (run[run.length - 1] as number) === streetStart - 1)));
    const pick = before[before.length - 1];
    if (!result.neighbourhood && pick) result.neighbourhood = claim(pick);
  } else if (!result.street && (result.houseNumber || result.district)) {
    const rest = wordRuns.filter((run) => run.some((i) => !used[i]));
    if (result.houseNumber && rest.length > 0) {
      const streetRun = rest[rest.length - 1] as number[];
      const text = claim(streetRun);
      const key = streetKey(text);
      result.street = { text, key: key.key, compact: key.compact, kind: null, number: key.number };
      const earlier = rest.slice(0, -1).filter((run) => run.some((i) => !used[i]));
      if (!result.neighbourhood && earlier.length > 0) result.neighbourhood = claim(earlier[earlier.length - 1] as number[]);
    } else if (!result.neighbourhood && result.district && rest.length === 1) {
      result.neighbourhood = claim(rest[0] as number[]);
    }
  }

  result.leftover = tokens.filter((_, i) => !used[i]).map((token) => token.t);
  return result;
}
