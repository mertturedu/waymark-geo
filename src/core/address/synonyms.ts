import { nameKey } from '../text/fold';

export const MAX_VARIANTS = 8;
const MAX_WORDS = 3;

const WORDS: string[][] = [
  ['belediye', 'belediyesi', 'belediye binasi', 'municipality', 'town hall', 'rathaus', 'мэрия', 'δημαρχείο'],
  ['hastane', 'hastanesi', 'hospital', 'krankenhaus', 'больница', 'νοσοκομείο', 'مستشفى'],
  ['eczane', 'eczanesi', 'pharmacy', 'apotheke', 'аптека', 'φαρμακείο', 'صيدلية'],
  ['okul', 'okulu', 'school', 'schule', 'школа', 'σχολείο', 'مدرسة'],
  ['avm', 'alisveris merkezi', 'mall', 'einkaufszentrum', 'торговый центр', 'εμπορικό κέντρο'],
  ['cami', 'camii', 'mosque', 'moschee', 'мечеть', 'τζαμί', 'مسجد'],
  ['universite', 'universitesi', 'university', 'universitat', 'университет', 'πανεπιστήμιο', 'جامعة'],
  ['polis', 'karakol', 'emniyet', 'police', 'polizei', 'полиция', 'αστυνομία'],
  ['postane', 'ptt', 'post office', 'postamt', 'почта', 'ταχυδρομείο'],
  ['banka', 'bank', 'банк', 'τράπεζα'],
  ['istasyon', 'gar', 'station', 'bahnhof', 'вокзал', 'σταθμός'],
  ['otel', 'hotel', 'отель', 'ξενοδοχείο'],
  ['adliye', 'mahkeme', 'courthouse', 'gericht', 'суд', 'δικαστήριο'],
  ['itfaiye', 'fire station', 'feuerwehr', 'пожарная часть', 'πυροσβεστική'],
  ['stadyum', 'stadium', 'stadion', 'стадион', 'στάδιο'],
  ['market', 'supermarket', 'supermarkt', 'супермаркет', 'σούπερ μάρκετ'],
  ['akaryakit', 'benzinlik', 'petrol ofisi', 'fuel', 'tankstelle', 'заправка', 'βενζινάδικο'],
  ['klinik', 'saglik ocagi', 'clinic', 'klinikum', 'клиника', 'κλινική'],
];

export const SYNONYM_CLASSES: string[][] = WORDS.map((members) => [...new Set(members.map(nameKey))]);

const CLASS_OF = new Map<string, number>();
SYNONYM_CLASSES.forEach((members, index) => {
  for (const m of members) CLASS_OF.set(m, index);
});

export function synonymVariants(key: string): string[] {
  const tokens = key.split(' ').filter((t) => t !== '');
  const original = tokens.join(' ');
  const out = [original];
  const seen = new Set(out);
  for (let i = 0; i < tokens.length; i += 1) {
    for (let len = Math.min(MAX_WORDS, tokens.length - i); len >= 1; len -= 1) {
      const phrase = tokens.slice(i, i + len).join(' ');
      const index = CLASS_OF.get(phrase);
      if (index === undefined) continue;
      for (const alt of SYNONYM_CLASSES[index] as string[]) {
        if (alt === phrase) continue;
        const variant = [...tokens.slice(0, i), alt, ...tokens.slice(i + len)].join(' ');
        if (seen.has(variant)) continue;
        seen.add(variant);
        out.push(variant);
        if (out.length >= MAX_VARIANTS) return out;
      }
      break;
    }
  }
  return out;
}
