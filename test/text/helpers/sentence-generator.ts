import type { AddressRecord, Expect } from './types';

export type { Expect };

export type Lang = 'tr' | 'en' | 'de' | 'ru' | 'el' | 'ar';

export type GeneratedCase = { text: string; lang: Lang; province: string; expect: Expect };

type Kind = 'cadde' | 'sokak' | 'bulvar' | 'yol' | 'cikmaz' | 'meydan';

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(next: () => number, list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
const chance = (next: () => number, p: number): boolean => next() < p;

const KIND_WORDS: [RegExp, Kind][] = [
  [/\s+(caddesi|cadde|cd\.?)$/i, 'cadde'],
  [/\s+(sokağı|sokak|sk\.?)$/i, 'sokak'],
  [/\s+(bulvarı|bulvar)$/i, 'bulvar'],
  [/\s+(yolu|yol)$/i, 'yol'],
  [/\s+(çıkmazı|çıkmaz)$/i, 'cikmaz'],
  [/\s+(meydanı|meydan)$/i, 'meydan'],
];

function splitStreet(name: string): { core: string; kind: Kind | null } {
  for (const [pattern, kind] of KIND_WORDS) if (pattern.test(name)) return { core: name.replace(pattern, ''), kind };
  return { core: name, kind: null };
}

const TR_KIND: Record<Kind, string[]> = {
  cadde: ['Caddesi', 'Caddesi', 'Cadde', 'Cd.', 'Cad.'],
  sokak: ['Sokağı', 'Sokak', 'Sk.', 'Sok.'],
  bulvar: ['Bulvarı', 'Bulvar', 'Blv.', 'Bulv.'],
  yol: ['Yolu', 'Yol'],
  cikmaz: ['Çıkmazı', 'Çıkmaz'],
  meydan: ['Meydanı', 'Meydan'],
};
const EN_KIND: Record<Kind, string[]> = { cadde: ['Avenue', 'Ave', 'Street'], sokak: ['Street', 'St'], bulvar: ['Boulevard', 'Blvd'], yol: ['Road', 'Rd'], cikmaz: ['Alley'], meydan: ['Square'] };
const DE_KIND: Record<Kind, string[]> = { cadde: ['Allee', 'Straße'], sokak: ['Straße', 'Str.', 'Gasse'], bulvar: ['Boulevard'], yol: ['Weg'], cikmaz: ['Sackgasse'], meydan: ['Platz'] };
const RU_KIND: Record<Kind, string[]> = { cadde: ['проспект', 'пр.'], sokak: ['ул.', 'улица'], bulvar: ['бульвар', 'бул.'], yol: ['дорога', 'шоссе'], cikmaz: ['тупик'], meydan: ['площадь', 'пл.'] };
const EL_KIND: Record<Kind, string[]> = { cadde: ['Λεωφόρος', 'Λεωφ.'], sokak: ['Οδός', 'Οδ.'], bulvar: ['Λεωφόρος'], yol: ['Δρόμος'], cikmaz: ['Αδιέξοδο'], meydan: ['Πλατεία'] };
const AR_KIND: Record<Kind, string[]> = { cadde: ['جادة', 'شارع'], sokak: ['شارع', 'زقاق'], bulvar: ['شارع'], yol: ['طريق'], cikmaz: ['مسدود'], meydan: ['ميدان'] };

const CYRILLIC: Record<string, string> = {
  a: 'а', b: 'б', c: 'дж', ç: 'ч', d: 'д', e: 'е', f: 'ф', g: 'г', ğ: 'г', h: 'х', ı: 'ы', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', ö: 'ё', p: 'п', r: 'р', s: 'с', ş: 'ш', t: 'т', u: 'у', ü: 'ю', v: 'в', y: 'й', z: 'з', w: 'в', x: 'кс', q: 'к',
};
const GREEK: Record<string, string> = {
  a: 'α', b: 'μπ', c: 'τζ', ç: 'τσ', d: 'ντ', e: 'ε', f: 'φ', g: 'γκ', ğ: 'γ', h: 'χ', ı: 'ι', i: 'ι', j: 'ζ', k: 'κ', l: 'λ', m: 'μ', n: 'ν', o: 'ο', ö: 'ο', p: 'π', r: 'ρ', s: 'σ', ş: 'σ', t: 'τ', u: 'ου', ü: 'ου', v: 'β', y: 'γι', z: 'ζ', w: 'β', x: 'ξ', q: 'κ',
};
const VOWELS = 'aeıioöuü';

function lowerTr(text: string): string {
  return Array.from(text)
    .map((ch) => (ch === 'İ' ? 'i' : ch === 'I' ? 'ı' : ch.toLowerCase()))
    .join('');
}

function upperTr(text: string): string {
  return Array.from(text)
    .map((ch) => (ch === 'i' ? 'İ' : ch === 'ı' ? 'I' : ch.toUpperCase()))
    .join('');
}

function toCyrillic(name: string): string {
  const lower = lowerTr(name);
  let out = '';
  const skip = new Set<number>();
  Array.from(lower).forEach((ch, i, chars) => {
    const previous = chars[i - 1] ?? ' ';
    if (skip.has(i)) return;
    if (ch === 'e' && (!/[a-zçğıöşüi]/.test(previous) || VOWELS.includes(previous))) out += 'э';
    else if (ch === 'y' && chars[i + 1] === 'a') {
      out += /[bcçdfgğhjklmnprsştvzwxq]/.test(previous) ? 'ья' : 'я';
      skip.add(i + 1);
    } else out += CYRILLIC[ch] ?? ch;
  });
  return out;
}

const AMBIGUOUS_GREEK = /nt|nd|mp|mb|ng|nk/;

function toGreek(name: string): string {
  const lower = lowerTr(name);
  const chars = Array.from(lower);
  return chars
    .map((ch, i) => {
      if (ch === 's' && !/[a-zçğıöşüi]/.test(chars[i + 1] ?? ' ')) return 'ς';
      if (ch === 'y') return VOWELS.includes(chars[i + 1] ?? ' ') ? 'γι' : 'ϊ';
      return GREEK[ch] ?? ch;
    })
    .join('');
}

function greekOrLatin(name: string, next: () => number): string {
  return AMBIGUOUS_GREEK.test(lowerTr(name)) || chance(next, 0.5) ? name : toGreek(name);
}

const PLAIN: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'C', Ğ: 'G', İ: 'I', Ö: 'O', Ş: 'S', Ü: 'U' };
const plain = (text: string): string => Array.from(text).map((ch) => PLAIN[ch] ?? ch).join('');

export type Parts = {
  lang: Lang;
  province: string;
  district: string;
  hood: string | null;
  street: string;
  number: string;
  door: string | null;
  floor: string | null;
  block: string | null;
};

function nameIn(lang: Lang, turkish: string, names: Record<string, string | undefined> | undefined, next: () => number): string {
  if (lang === 'ru') return names?.ru && chance(next, 0.7) ? names.ru : toCyrillic(turkish);
  if (lang === 'el') return names?.el && chance(next, 0.5) ? names.el : greekOrLatin(turkish, next);
  if (lang === 'ar') return names?.ar ? names.ar : turkish;
  return turkish;
}

function streetIn(lang: Lang, core: string, kind: Kind | null, original: string, next: () => number): string {
  if (kind === null) return original;
  if (lang === 'tr') return `${core} ${pick(next, TR_KIND[kind])}`;
  if (lang === 'en') return `${core} ${pick(next, EN_KIND[kind])}`;
  if (lang === 'de') return `${core} ${pick(next, DE_KIND[kind])}`;
  if (lang === 'ru') return `${pick(next, RU_KIND[kind])} ${toCyrillic(core)}`;
  if (lang === 'el') return `${pick(next, EL_KIND[kind])} ${greekOrLatin(core, next)}`;
  return `${pick(next, AR_KIND[kind])} ${core}`;
}

function extras(lang: Lang, parts: Parts, next: () => number): string[] {
  const out: string[] = [];
  const v = (tr: string[], en: string[], de: string[], ru: string[], el: string[], ar: string[]) => pick(next, { tr, en, de, ru, el, ar }[lang]);
  if (parts.floor) out.push(v([`Kat ${parts.floor}`, `K:${parts.floor}`, `${parts.floor}. Kat`], [`floor ${parts.floor}`], [`Etage ${parts.floor}`], [`этаж ${parts.floor}`], [`όροφος ${parts.floor}`], [`طابق ${parts.floor}`]));
  if (parts.block) out.push(v([`${parts.block} Blok`, `Blok ${parts.block}`], [`block ${parts.block}`], [`Block ${parts.block}`], [`корпус ${parts.block}`], [`μπλοκ ${parts.block}`], [`بلوك ${parts.block}`]));
  if (parts.door) out.push(v([`Daire ${parts.door}`, `D:${parts.door}`, `Daire No: ${parts.door}`, `D ${parts.door}`], [`apartment ${parts.door}`], [`Wohnung ${parts.door}`], [`кв. ${parts.door}`, `квартира ${parts.door}`], [`διαμέρισμα ${parts.door}`], [`شقة ${parts.door}`]));
  return out;
}

function hoodIn(lang: Lang, hood: string, next: () => number): string {
  if (lang === 'tr') return pick(next, [`${hood} Mah.`, `${hood} Mahallesi`, `${hood} Mh.`]);
  if (lang === 'en') return pick(next, [`${hood} Neighbourhood`, `${hood} Mah.`]);
  if (lang === 'de') return pick(next, [`${hood} Viertel`, `${hood} Ortsteil`]);
  if (lang === 'ru') return pick(next, [`мкр. ${hood}`, `микрорайон ${hood}`]);
  if (lang === 'el') return `γειτονιά ${hood}`;
  return `حي ${hood}`;
}

function numberIn(lang: Lang, number: string, next: () => number): { before: boolean; text: string } {
  if (lang === 'tr') return { before: false, text: pick(next, [`No: ${number}`, `No ${number}`, `Numara ${number}`, `Kapı No: ${number}`, number]) };
  if (lang === 'en') return chance(next, 0.5) ? { before: true, text: number } : { before: false, text: pick(next, [`no ${number}`, `number ${number}`, number]) };
  if (lang === 'de') return { before: false, text: pick(next, [number, `Nr. ${number}`, `Nummer ${number}`]) };
  if (lang === 'ru') return { before: false, text: pick(next, [`д. ${number}`, `дом ${number}`, number]) };
  if (lang === 'el') return { before: false, text: pick(next, [`αρ. ${number}`, `αριθμός ${number}`, number]) };
  return { before: false, text: `رقم ${number}` };
}

function applyCase(text: string, lang: Lang, next: () => number): string {
  let out = text;
  if (lang !== 'ru' && lang !== 'el' && lang !== 'ar' && chance(next, 0.3)) out = plain(out);
  const roll = next();
  if (lang === 'ar') return out;
  if (roll < 0.15) return lang === 'ru' || lang === 'el' ? out.toLowerCase() : lowerTr(out);
  if (roll < 0.25) return lang === 'ru' || lang === 'el' ? out.toUpperCase() : upperTr(out);
  return out;
}

export function renderParts(parts: Parts, next: () => number, options: { hoodMarker: boolean }): string {
  const { lang } = parts;
  const { core, kind } = splitStreet(parts.street);
  const street = streetIn(lang, core, kind, parts.street, next);
  const number = numberIn(lang, parts.number, next);
  const streetText = number.before ? `${number.text} ${street}` : `${street} ${number.text}`;
  const ex = extras(lang, parts, next);
  const hood = parts.hood === null ? null : options.hoodMarker ? hoodIn(lang, nameIn(lang, parts.hood, undefined, next), next) : nameIn(lang, parts.hood, undefined, next);
  const place = [parts.province, parts.district];
  const placeText = chance(next, 0.5) ? place.join(' ') : place.reverse().join(chance(next, 0.5) ? ' ' : '/');
  const head = [hood, [streetText, ...ex].join(' ')].filter(Boolean) as string[];
  if (hood !== null && !options.hoodMarker) return [...head, placeText].join(', ');
  const order = next();
  if (order < 0.4) return [...head, placeText].join(', ');
  if (order < 0.7) return [placeText, ...head].join(' ').replace(/\s+/g, ' ');
  return [placeText, ...head].join(', ');
}

export function generateSentences(records: AddressRecord[], count: number, seed: number): GeneratedCase[] {
  const next = rng(seed);
  const order = records.map((_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j] as number, order[i] as number];
  }
  const langs: Lang[] = ['tr', 'tr', 'tr', 'tr', 'en', 'de', 'ru', 'el', 'ar', 'tr'];
  const out: GeneratedCase[] = [];
  for (let i = 0; i < count; i++) {
    const record = records[order[i % order.length] as number] as AddressRecord;
    const lang = langs[i % langs.length] as Lang;
    const withDistrict = chance(next, 0.9);
    const withProvince = chance(next, 0.8);
    const marker = chance(next, 0.8) || !withDistrict || (record.neighbourhood ?? '').toLowerCase() === record.district.toLowerCase();
    const hood = record.neighbourhood && chance(next, 0.8) ? record.neighbourhood : null;
    const extra = chance(next, 0.25);
    const parts: Parts = {
      lang,
      province: withProvince ? nameIn(lang, record.provinceName, undefined, next) : '',
      district: withDistrict ? nameIn(lang, record.district, record.districtNames, next) : '',
      hood,
      street: record.street,
      number: record.houseNumber,
      door: extra ? String(1 + Math.floor(next() * 30)) : null,
      floor: extra && chance(next, 0.6) ? String(1 + Math.floor(next() * 8)) : null,
      block: extra && chance(next, 0.3) ? pick(next, ['A', 'B', 'C', 'D', 'E', 'K']) : null,
    };
    const postcode = chance(next, 0.08) ? `${record.province}${String(100 + Math.floor(next() * 900))}` : null;
    const rendered = renderParts(parts, next, { hoodMarker: marker || hood === null });
    const arabicComma = lang === 'ar' && chance(next, 0.4);
    const raw = [arabicComma ? rendered.split(', ').join('، ') : rendered, postcode].filter(Boolean).join(arabicComma ? '، ' : ', ');
    const text = applyCase(raw.replace(/\s+,/g, ',').replace(/^[,\s]+/, ''), lang, next);
    out.push({
      text,
      lang,
      province: record.province,
      expect: {
        ...(withProvince ? { province: record.province } : {}),
        ...(withDistrict ? { district: record.district, districtPlate: record.province } : {}),
        ...(postcode ? { postcode } : {}),
        ...(hood ? { neighbourhood: hood } : {}),
        street: record.street,
        houseNumber: record.houseNumber,
        ...(parts.door ? { door: parts.door } : {}),
        ...(parts.floor ? { floor: parts.floor } : {}),
        ...(parts.block ? { block: parts.block } : {}),
      },
    });
  }
  return out;
}
