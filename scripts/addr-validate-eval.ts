import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { provinceName } from '../src/core/text/admin';
import type { NoteCode } from '../src/core/address/validate-text';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch } from './addr-eval';
import { pick, seeded, seedOf } from './addr-sets';
import { addressPackOf } from './build-buildings-v2';

const PLATES = ['34', '06', '35', '16', '41'];
const ISSUES = ['district_mismatch', 'street_not_in_neighbourhood', 'missing_number', 'number_out_of_range', 'missing_neighbourhood', 'ambiguous_street'] as const;
type Issue = (typeof ISSUES)[number];

type Door = { street: number; district: number; hood: number; num: number };
export type Data = {
  plate: string;
  streets: Map<number, string>;
  districts: Map<number, string>;
  hoods: Map<number, { name: string; district: number }>;
  doors: Door[];
  hoodsOf: Map<number, Set<number>>;
  maxNum: Map<string, number>;
  hoodsByNumber: Map<string, Set<number>>;
  districtsByName: Map<string, Set<number>>;
};

export function load(plate: string): Data {
  const db = new DatabaseSync(addressPackOf(plate), { readOnly: true });
  const streets = new Map((db.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const districts = new Map((db.prepare('SELECT id, name FROM district').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
  const hoods = new Map((db.prepare('SELECT id, name, district_id FROM neighbourhood').all() as { id: number; name: string; district_id: number }[]).map((r) => [r.id, { name: r.name, district: r.district_id }]));
  const doors = (db.prepare("SELECT street_id, district_id, hood_id, num FROM address WHERE street_id IS NOT NULL AND hood_id IS NOT NULL AND num IS NOT NULL AND suffix = ''").all() as { street_id: number; district_id: number; hood_id: number; num: number }[]).map((r) => ({ street: r.street_id, district: r.district_id, hood: r.hood_id, num: r.num }));
  const parts = db.prepare('SELECT name_id, district_id, hood_id FROM street_part').all() as { name_id: number; district_id: number; hood_id: number | null }[];
  db.close();
  const hoodsOf = new Map<number, Set<number>>();
  const add = (street: number, hood: number | null): void => {
    if (hood === null) return;
    const set = hoodsOf.get(street) ?? new Set<number>();
    set.add(hood);
    hoodsOf.set(street, set);
  };
  for (const p of parts) add(p.name_id, p.hood_id);
  for (const d of doors) add(d.street, d.hood);
  const maxNum = new Map<string, number>();
  const hoodsByNumber = new Map<string, Set<number>>();
  const districtsByName = new Map<string, Set<number>>();
  for (const d of doors) {
    const key = `${d.street}:${d.district}`;
    maxNum.set(key, Math.max(maxNum.get(key) ?? 0, d.num));
    const nk = `${d.street}:${d.district}:${d.num}`;
    const set = hoodsByNumber.get(nk) ?? new Set<number>();
    set.add(d.hood);
    hoodsByNumber.set(nk, set);
  }
  for (const p of parts) {
    const name = streets.get(p.name_id) ?? '';
    const set = districtsByName.get(name) ?? new Set<number>();
    set.add(p.district_id);
    districtsByName.set(name, set);
  }
  return { plate, streets, districts, hoods, doors, hoodsOf, maxNum, hoodsByNumber, districtsByName };
}

const hoodWord = (name: string): string => `${name} Mah.`;

type Case = { issue: Issue | 'clean'; text: string };

function casesFor(data: Data, perIssue: number): Case[] {
  const rng = seeded(seedOf(`validate-${data.plate}`));
  const province = provinceName(data.plate) ?? data.plate;
  const out: Case[] = [];
  const sample = data.doors.filter((_, i) => i % Math.max(1, Math.floor(data.doors.length / (perIssue * 40))) === 0);
  const clean = (d: Door): string => `${hoodWord(data.hoods.get(d.hood)?.name ?? '')} ${data.streets.get(d.street)} No:${d.num} ${data.districts.get(d.district)}/${province}`;
  const counts: Record<string, number> = { clean: 0 };
  for (const issue of ISSUES) counts[issue] = 0;
  for (const d of [...sample].sort(() => rng() - 0.5)) {
    const street = data.streets.get(d.street) ?? '';
    const district = data.districts.get(d.district) ?? '';
    const hood = data.hoods.get(d.hood)?.name ?? '';
    if (!street || !district || !hood) continue;
    if (counts.clean! < perIssue) {
      out.push({ issue: 'clean', text: clean(d) });
      counts.clean!++;
    }
    if (counts.district_mismatch! < perIssue) {
      const others = [...data.districts].filter(([id]) => id !== d.district);
      const [, other] = pick(rng, others);
      out.push({ issue: 'district_mismatch', text: `${hoodWord(hood)} ${street} No:${d.num} ${other}/${province}` });
      counts.district_mismatch!++;
    }
    if (counts.street_not_in_neighbourhood! < perIssue) {
      const own = data.hoodsOf.get(d.street) ?? new Set<number>();
      const pool = [...data.hoods].filter(([id, h]) => h.district === d.district && !own.has(id));
      if (pool.length > 0) {
        const [, other] = pick(rng, pool);
        out.push({ issue: 'street_not_in_neighbourhood', text: `${hoodWord(other.name)} ${street} No:${d.num} ${district}/${province}` });
        counts.street_not_in_neighbourhood!++;
      }
    }
    if (counts.missing_number! < perIssue) {
      out.push({ issue: 'missing_number', text: `${hoodWord(hood)} ${street} ${district}/${province}` });
      counts.missing_number!++;
    }
    if (counts.number_out_of_range! < perIssue) {
      const max = data.maxNum.get(`${d.street}:${d.district}`) ?? d.num;
      out.push({ issue: 'number_out_of_range', text: `${hoodWord(hood)} ${street} No:${max + 400 + (max % 2 === d.num % 2 ? 0 : 1)} ${district}/${province}` });
      counts.number_out_of_range!++;
    }
    if (counts.missing_neighbourhood! < perIssue && (data.hoodsByNumber.get(`${d.street}:${d.district}:${d.num}`)?.size ?? 0) >= 2) {
      out.push({ issue: 'missing_neighbourhood', text: `${street} No:${d.num} ${district}/${province}` });
      counts.missing_neighbourhood!++;
    }
    if (counts.ambiguous_street! < perIssue && (data.districtsByName.get(street)?.size ?? 0) >= 3) {
      out.push({ issue: 'ambiguous_street', text: `${street} ${province}` });
      counts.ambiguous_street!++;
    }
    if (Object.values(counts).every((n) => n >= perIssue)) break;
  }
  return out;
}

const SEVERE = new Set<string>(['warning', 'error']);

const dropLetter = (word: string, at: number): string => word.slice(0, at) + word.slice(at + 1);

async function suggest(perPlate: number): Promise<void> {
  const search = await openSearch();
  const tally: Record<string, { n: number; right: number; any: number }> = { neighbourhood: { n: 0, right: 0, any: 0 }, district: { n: 0, right: 0, any: 0 }, street: { n: 0, right: 0, any: 0 } };
  for (const plate of PLATES) {
    const data = load(plate);
    const province = provinceName(plate) ?? plate;
    const rng = seeded(seedOf(`suggest-${plate}`));
    for (let i = 0; i < perPlate; i++) {
      const d = pick(rng, data.doors);
      const street = data.streets.get(d.street) ?? '';
      const district = data.districts.get(d.district) ?? '';
      const hood = data.hoods.get(d.hood)?.name ?? '';
      const first = street.split(' ')[0] ?? '';
      const trials: [string, string, string, string][] = [
        ['neighbourhood', hood, hood.length >= 6 ? dropLetter(hood, 2) : hood, `${hoodWord(dropLetter(hood, 2))} ${street} No:${d.num} ${district}/${province}`],
        ['district', district, district.length >= 6 ? dropLetter(district, 3) : district, `${hoodWord(hood)} ${street} No:${d.num} ${dropLetter(district, 3)} ${province}`],
        ['street', street, first.length >= 6 ? street.replace(first, dropLetter(first, 2)) : street, `${hoodWord(hood)} ${first.length >= 6 ? street.replace(first, dropLetter(first, 2)) : street} No:${d.num} ${district}/${province}`],
      ];
      for (const [field, truth, typed, text] of trials) {
        if (typed === truth) continue;
        const v = await search.validate(text, { language: 'tr' });
        const t = tally[field] as { n: number; right: number; any: number };
        const suggested = v.suggestions[field as 'street'];
        t.n++;
        if (suggested !== undefined) t.any++;
        if (suggested !== undefined && suggested.toLocaleLowerCase('tr-TR').startsWith(truth.toLocaleLowerCase('tr-TR').split(' ')[0] as string)) t.right++;
        else if (field === 'street' && v.place?.components.street?.toLocaleLowerCase('tr-TR') === truth.toLocaleLowerCase('tr-TR')) t.right++;
      }
    }
    search.invalidate(plate);
  }
  const pct = (a: number, b: number): number => (b === 0 ? 0 : Number(((100 * a) / b).toFixed(1)));
  const result = Object.fromEntries(Object.entries(tally).map(([k, v]) => [k, { n: v.n, suggested: pct(v.any, v.n), right: pct(v.right, v.n) }]));
  console.log('Bunu mu demek istediniz (bir harf silinmiş yazım):', JSON.stringify(result));
  recordMeasure('a9_suggest', result);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'suggest') return suggest(Number(process.argv[3] ?? 150));
  const perIssue = Number(process.argv[2] ?? 150);
  const search = await openSearch();
  const caught = new Map<string, { n: number; hit: number; statusOk: number }>();
  let cleanN = 0;
  let cleanFalse = 0;
  const falseCodes = new Map<string, number>();
  const show = Number(process.env.SHOW ?? 0);
  let shown = 0;
  for (const plate of PLATES) {
    const data = load(plate);
    for (const c of casesFor(data, perIssue)) {
      const v = await search.validate(c.text, { language: 'tr' });
      const codes = v.notes.map((n) => n.code as NoteCode);
      if (c.issue === 'clean') {
        cleanN++;
        const bad = v.notes.filter((n) => SEVERE.has(n.severity));
        if (bad.length > 0) {
          cleanFalse++;
          for (const n of bad) falseCodes.set(n.code, (falseCodes.get(n.code) ?? 0) + 1);
          if (shown++ < show) console.log('  yanlış not:', c.text, '→', codes.join(','));
        }
        continue;
      }
      const t = caught.get(c.issue) ?? { n: 0, hit: 0, statusOk: 0 };
      t.n++;
      if (codes.includes(c.issue) || (c.issue === 'number_out_of_range' && codes.includes('number_not_on_street'))) t.hit++;
      else if (shown++ < show) console.log(`  kaçan ${c.issue}:`, c.text, '→', v.status, codes.join(','), v.place?.precision);
      if (v.status !== 'ok') t.statusOk++;
      caught.set(c.issue, t);
    }
    search.invalidate(plate);
  }
  const pct = (a: number, b: number): number => (b === 0 ? 0 : Number(((100 * a) / b).toFixed(1)));
  const per = Object.fromEntries([...caught].map(([k, v]) => [k, { n: v.n, caught: pct(v.hit, v.n), notOk: pct(v.statusOk, v.n) }]));
  const total = [...caught.values()].reduce((a, v) => ({ n: a.n + v.n, hit: a.hit + v.hit }), { n: 0, hit: 0 });
  const result = { corrupted: total.n, caught: pct(total.hit, total.n), per, clean: cleanN, falseRate: pct(cleanFalse, cleanN), falseCodes: Object.fromEntries(falseCodes) };
  console.log(`doğrulama: bozulan ${total.n} kayıtta doğru not %${result.caught}; temiz ${cleanN} kayıtta yanlış not %${result.falseRate}`);
  for (const [k, v] of Object.entries(per)) console.log(`  ${k.padEnd(28)} ${String(v.n).padStart(4)}  doğru not %${v.caught}  ok olmayan %${v.notOk}`);
  console.log('  yanlış not kodları', result.falseCodes);
  recordMeasure('a9_validate', result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
