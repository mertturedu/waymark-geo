import { nameKey } from '../text/fold';

const TABLE: [string, readonly string[]][] = [
  ['eczane eczanesi pharmacy apotheke аптека φαρμακείο صيدلية', ['pharmacy']],
  ['hastane hastanesi klinik poliklinik hospital clinic krankenhaus больница клиника νοσοκομείο κλινική مستشفى عيادة', ['hospital', 'clinic', 'health']],
  ['akaryakit benzinlik petrol tankstelle заправка бензоколонка βενζινάδικο بنزين', ['fuel']],
  ['otel hotel pansiyon konaklama pension отель гостиница ξενοδοχείο فندق', ['hotel', 'lodging']],
  ['market supermarket bakkal supermarkt супермаркет σουπερμάρκετ سوبرماركت', ['supermarket', 'market']],
  ['avm einkaufszentrum مول', ['mall']],
  ['cami camii mescit mosque moschee мечеть τζαμί مسجد جامع', ['mosque', 'worship']],
  ['banka atm bank банк τράπεζα بنك مصرف', ['bank', 'money']],
  ['karakol polis itfaiye adliye police polizei feuerwehr полиция αστυνομία شرطة إطفاء', ['police', 'fire_station', 'courthouse', 'safety']],
  ['okul lise ilkokul ortaokul universite school university schule universitat школа университет σχολείο πανεπιστήμιο مدرسة جامعة', ['school', 'university']],
  ['postane ptt почта ταχυδρομείο بريد', ['post_office']],
  ['belediye rathaus ратуша δημαρχείο بلدية', ['townhall']],
  ['stadyum stadion стадион στάδιο ملعب', ['stadium']],
  ['restoran lokanta kafe cafe restaurant ресторан кафе εστιατόριο مطعم مقهى', ['food']],
];

const WORDS = new Map<string, readonly string[]>(TABLE.flatMap(([words, kinds]) => words.split(' ').map((w): [string, readonly string[]] => [nameKey(w), kinds])));

export type CategoryAsk = { kinds: string[]; rest: string };

export function categoryOf(key: string): CategoryAsk | null {
  const kinds = new Set<string>();
  const rest: string[] = [];
  for (const word of key.split(' ')) {
    const hit = WORDS.get(word);
    if (hit) for (const kind of hit) kinds.add(kind);
    else rest.push(word);
  }
  return kinds.size === 0 ? null : { kinds: [...kinds], rest: rest.join(' ') };
}
