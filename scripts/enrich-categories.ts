import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ask, MODELS } from '../tools/ollama';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const OVERTURE = join(repoRoot, 'dist', 'work', '261028', 'overture');
export const MODEL_FILE = join(repoRoot, 'pipeline', 'data', 'category-groups-model.json');
export const GROUPS = ['pharmacy', 'health', 'safety', 'cargo', 'money', 'fuel', 'worship', 'lodging', 'market', 'food', 'public', 'shop', 'other'] as const;
export const MIN_PRECISION = 0.95;

type Group = (typeof GROUPS)[number];
type Cat = { cat: string; count: number; group: string; tax: string };

const SYSTEM = [
  'You map a business category from a Turkish map data set to the search group a map user would look it up under.',
  'Groups: pharmacy (pharmacy, drugstore); health (hospital, clinic, dentist, doctor, veterinary, medical lab, optician-clinic); safety (police, fire station, court, prison); cargo (courier, shipping, post office);',
  'money (bank, ATM, currency exchange, financial service); fuel (gas station, car wash, auto repair, tyres, car dealer, auto parts); worship (mosque, church, synagogue, temple); lodging (hotel, hostel, guest house, resort, campground);',
  'market (supermarket, grocery, convenience store, shopping centre, department store, bazaar, butcher, greengrocer); food (restaurant, cafe, bakery, bar, fast food, pastry, dessert); public (government office, school, kindergarten, university, library, public service, station, cemetery, public bath);',
  'shop (retail store, boutique, salon, clothing, furniture, electronics, jewelry, phone shop, florist, hairdresser, barber, beauty); other (everything else: professional and business services, manufacturing, construction, real estate, sports, entertainment, parks, religious or social organisations and so on).',
  'Answer with exactly one group.',
].join(' ');

const SCHEMA = { type: 'object', properties: { group: { type: 'string', enum: [...GROUPS] } }, required: ['group'] } as const;

function categories(): Cat[] {
  const table = new Map<string, { count: number; group: string; taxes: Map<string, number> }>();
  for (const file of readdirSync(OVERTURE).filter((f) => f.endsWith('.rows.jsonl'))) {
    for (const line of readFileSync(join(OVERTURE, file), 'utf8').split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as { cat: string; g: string; tax?: string };
      if (!row.cat) continue;
      const entry = table.get(row.cat) ?? { count: 0, group: row.g, taxes: new Map() };
      entry.count++;
      if (row.tax) entry.taxes.set(row.tax, (entry.taxes.get(row.tax) ?? 0) + 1);
      table.set(row.cat, entry);
    }
  }
  return [...table].map(([cat, e]) => ({ cat, count: e.count, group: e.group, tax: [...e.taxes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' })).sort((a, b) => b.count - a.count || (a.cat < b.cat ? -1 : 1));
}

async function guess(model: string, item: Cat): Promise<Group | null> {
  const answer = await ask<{ group: string }>(model, SYSTEM, `Category: ${item.cat}${item.tax ? `\nTaxonomy: ${item.tax.replace(/>/g, ' > ')}` : ''}`, SCHEMA, { numPredict: 30 });
  return answer && (GROUPS as readonly string[]).includes(answer.group) ? (answer.group as Group) : null;
}

export type CategoryReport = { categories: number; known: number; unknown: number; agreeKnown: number; agreeRight: number; precision: Record<string, { n: number; right: number }>; accepted: Record<string, Group>; acceptedPois: number; otherPois: number; models: string[] };

export async function runCategories(limit = Infinity): Promise<{ report: CategoryReport; text: string }> {
  const all = categories().slice(0, limit);
  const known = all.filter((c) => c.group !== 'other');
  const unknown = all.filter((c) => c.group === 'other');
  const answers = new Map<string, Group[]>();
  for (const model of MODELS) {
    for (const item of all) {
      const g = await guess(model, item);
      if (g) answers.set(item.cat, [...(answers.get(item.cat) ?? []), g]);
    }
  }
  const agree = (cat: string): Group | null => {
    const got = answers.get(cat) ?? [];
    return got.length === MODELS.length && got.every((g) => g === got[0]) ? (got[0] as Group) : null;
  };
  const precision: Record<string, { n: number; right: number }> = {};
  let agreeKnown = 0;
  let agreeRight = 0;
  for (const item of known) {
    const g = agree(item.cat);
    if (!g) continue;
    agreeKnown++;
    const slot = (precision[g] ??= { n: 0, right: 0 });
    slot.n++;
    if (g === item.group) {
      slot.right++;
      agreeRight++;
    }
  }
  const trusted = new Set(Object.entries(precision).filter(([, v]) => v.n >= 5 && v.right / v.n >= MIN_PRECISION).map(([g]) => g));
  const accepted: Record<string, Group> = {};
  for (const item of unknown) {
    const g = agree(item.cat);
    if (g && g !== 'other' && trusted.has(g)) accepted[item.cat] = g;
  }
  const byCat = new Map(all.map((c) => [c.cat, c]));
  const acceptedPois = Object.keys(accepted).reduce((t, c) => t + (byCat.get(c)?.count ?? 0), 0);
  const otherPois = unknown.reduce((t, c) => t + c.count, 0);
  const report: CategoryReport = { categories: all.length, known: known.length, unknown: unknown.length, agreeKnown, agreeRight, precision, accepted, acceptedPois, otherPois, models: [...MODELS] };
  const rows = Object.entries(precision).sort((a, b) => b[1].n - a[1].n).map(([g, v]) => `| ${g} | ${v.n} | ${v.right} | %${((100 * v.right) / v.n).toFixed(1)} | ${trusted.has(g) ? 'evet' : 'hayır'} |`);
  const sample = Object.entries(accepted).slice(0, 40).map(([c, g]) => `${c} → ${g}`).join(', ');
  const text = ['# Kategori → grup eşlemesi (yerel model)', '', `Modeller: ${MODELS.join(' ve ')}; sorgu: kategori adı ve sınıflandırma yolu; ikisi aynı cevabı vermedikçe eşleme yok. ${all.length} kategori (81 il, ${known.length} tanesi kural sözlüğüyle gruplu, ${unknown.length} tanesi "other").`, '', `**Kesinlik ölçümü (gizlenmiş kural etiketine karşı):** iki modelin aynı cevabı verdiği ${agreeKnown} kural gruplu kategoriden ${agreeRight}'i kuralla aynı (%${((100 * agreeRight) / Math.max(1, agreeKnown)).toFixed(1)}). Eşik %${MIN_PRECISION * 100} ve grup başına en az 5 örnek.`, '', '| Grup | İki modelin anlaştığı | Kuralla aynı | Kesinlik | Güvenilir |', '|---|---|---|---|---|', ...rows, '', `**Kabul edilen:** ${Object.keys(accepted).length} kategori, ${acceptedPois} işletme (81 ilde "other" olan ${otherPois} işletmenin %${((100 * acceptedPois) / Math.max(1, otherPois)).toFixed(1)}'i).`, '', `Örnekler: ${sample}`, ''].join('\n');
  return { report, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const limit = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : Infinity;
  runCategories(limit).then(({ report, text }) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16b-kategori.md'), text);
    if (limit === Infinity) writeFileSync(MODEL_FILE, `${JSON.stringify({ models: report.models, minPrecision: MIN_PRECISION, precision: report.precision, groups: report.accepted }, null, 1)}\n`);
    console.log(JSON.stringify({ categories: report.categories, agreeKnown: report.agreeKnown, agreeRight: report.agreeRight, accepted: Object.keys(report.accepted).length, acceptedPois: report.acceptedPois, otherPois: report.otherPois, wrote: limit === Infinity }));
  });
}
