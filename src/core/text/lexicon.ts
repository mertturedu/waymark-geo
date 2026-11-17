import { nameKey } from './fold';
import type { Lang, WordKind } from './types';

export const LANGS: readonly Lang[] = ['tr', 'en', 'de', 'ru', 'el', 'ar'];

const KINDS: readonly WordKind[] = ['sokak', 'cadde', 'bulvar', 'yol', 'cikmaz', 'meydan', 'mahalle', 'numara', 'daire', 'kat', 'blok', 'site', 'bina'];

const TABLE: Record<Lang, Record<WordKind, string>> = {
  tr: {
    sokak: 'sokak sokağı sk sok',
    cadde: 'cadde caddesi cd cad',
    bulvar: 'bulvar bulvarı blv bulv bul',
    yol: 'yol yolu asfaltı',
    cikmaz: 'çıkmaz çıkmazı cmz çık',
    meydan: 'meydan meydanı',
    mahalle: 'mahalle mahallesi mh mah',
    numara: 'no n numara numarası numaralı nolu kapı',
    daire: 'daire dairesi d',
    kat: 'kat katı katta k',
    blok: 'blok blk',
    site: 'site sitesi',
    bina: 'bina binası apartman apartmanı apt rezidans residence plaza merkezi',
  },
  en: {
    sokak: 'street st lane ln',
    cadde: 'avenue ave av',
    bulvar: 'boulevard blvd',
    yol: 'road rd',
    cikmaz: 'alley',
    meydan: 'square sq plaza',
    mahalle: 'neighbourhood neighborhood quarter mah',
    numara: 'no number nr num',
    daire: 'apartment apt flat unit',
    kat: 'floor fl level',
    blok: 'block blk',
    site: 'complex estate compound',
    bina: 'building bldg',
  },
  de: {
    sokak: 'straße str gasse',
    cadde: 'allee',
    bulvar: 'boulevard',
    yol: 'weg chaussee',
    cikmaz: 'sackgasse',
    meydan: 'platz pl',
    mahalle: 'viertel stadtteil ortsteil',
    numara: 'nummer nr hausnummer',
    daire: 'wohnung whg',
    kat: 'stock etage og geschoss',
    blok: 'block blk',
    site: 'siedlung anlage',
    bina: 'gebäude haus geb',
  },
  ru: {
    sokak: 'улица ул переулок пер',
    cadde: 'проспект пр просп',
    bulvar: 'бульвар бул',
    yol: 'дорога шоссе тракт',
    cikmaz: 'тупик туп',
    meydan: 'площадь пл',
    mahalle: 'микрорайон мкр квартал',
    numara: 'номер дом д',
    daire: 'квартира кв',
    kat: 'этаж эт',
    blok: 'корпус корп блок',
    site: 'комплекс жк',
    bina: 'здание зд строение стр',
  },
  el: {
    sokak: 'οδός οδ',
    cadde: 'λεωφόρος λεωφ',
    bulvar: 'βουλεβάρδο μπουλβάρ',
    yol: 'δρόμος',
    cikmaz: 'αδιέξοδο',
    meydan: 'πλατεία πλ',
    mahalle: 'γειτονιά συνοικία',
    numara: 'αριθμός αρ νούμερο',
    daire: 'διαμέρισμα διαμ',
    kat: 'όροφος όρ οροφ',
    blok: 'μπλοκ',
    site: 'συγκρότημα',
    bina: 'κτίριο οικοδομή',
  },
  ar: {
    sokak: 'شارع زقاق',
    cadde: 'جادة جاده',
    bulvar: 'بولفار',
    yol: 'طريق',
    cikmaz: 'مسدود',
    meydan: 'ميدان ساحة',
    mahalle: 'حي منطقة محلة محله',
    numara: 'رقم',
    daire: 'شقة شقه',
    kat: 'طابق دور',
    blok: 'بلوك كتلة',
    site: 'مجمع',
    bina: 'مبنى بناية عمارة بناء',
  },
};

export type WordHit = { kind: WordKind; lang: Lang };

let index: Map<string, WordHit[]> | null = null;
const lists = new Map<string, string[]>();

function words(lang: Lang, kind: WordKind): string[] {
  const id = `${lang}/${kind}`;
  let list = lists.get(id);
  if (!list) {
    list = TABLE[lang][kind].split(' ').map(nameKey);
    lists.set(id, list);
  }
  return list;
}

function build(): Map<string, WordHit[]> {
  const map = new Map<string, WordHit[]>();
  for (const lang of LANGS)
    for (const kind of KINDS)
      for (const word of words(lang, kind)) {
        const hits = map.get(word);
        if (hits) hits.push({ kind, lang });
        else map.set(word, [{ kind, lang }]);
      }
  return map;
}

export function wordsOf(lang: Lang, kind: WordKind): string[] {
  return words(lang, kind);
}

export function lookupWords(key: string): WordHit[] {
  index ??= build();
  return index.get(key) ?? [];
}

export function lookupWord(key: string, preferred: readonly Lang[] = LANGS): { kind: WordKind; langs: Lang[] } | null {
  const hits = lookupWords(key);
  if (hits.length === 0) return null;
  const first = preferred.map((lang) => hits.find((hit) => hit.lang === lang)).find((hit) => hit !== undefined) ?? (hits[0] as WordHit);
  return { kind: first.kind, langs: hits.filter((hit) => hit.kind === first.kind).map((hit) => hit.lang) };
}

const PREFIX_ROOTS =
  'hastane belediye kaymakam valilik adliye emniyet okul lise universite fakulte otogar terminal havalimani havaalani istasyon tapu nufus itfaiye cezaevi kampus fabrika organize mudurlugu hukumet noter kutuphane muze hospital university school airport station museum library court police embassy mosque krankenhaus rathaus universitat schule bahnhof flughafen bibliothek gericht polizei moschee больниц мэри университет школ вокзал аэропорт музе библиотек суд полици мечет νοσοκομ δημαρχ πανεπιστ σχολ σταθμ αεροδρομ μουσε βιβλιοθ δικαστ αστυνομ τζαμ مستشفى بلدية جامعة مدرسة محطة مطار متحف مكتبة محكمة شرطة مسجد';

const EXACT_ROOTS = 'ptt sgk avm otel hotel banka bank parki pazari camii mall cami carsi carsisi';

export const POI_ROOTS: ReadonlySet<string> = new Set([...PREFIX_ROOTS.split(' '), ...EXACT_ROOTS.split(' ')].map(nameKey));

const MIN_PREFIX = 5;
const PREFIXES = PREFIX_ROOTS.split(' ').map(nameKey).filter((root) => root.length >= MIN_PREFIX);
const EXACT = new Set([...EXACT_ROOTS.split(' '), ...PREFIX_ROOTS.split(' ').filter((root) => nameKey(root).length < MIN_PREFIX), 'okulu', 'lisesi', 'muzesi'].map(nameKey));

export function isPoiWord(key: string): boolean {
  if (key === '') return false;
  return EXACT.has(key) || PREFIXES.some((root) => key.startsWith(root));
}
