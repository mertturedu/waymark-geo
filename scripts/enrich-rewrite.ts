import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import type { Search } from '../src/core/address/search';
import { ask, MODELS } from '../tools/ollama';
import { rng, shuffle } from '../test/sim/random';
import { openSearch } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

export const PLATES = ['34', '06', '35'];
const FAILED = 150;
const FINE = 150;
const NEAR_M = 50;

const SYSTEM = 'You fix typing mistakes in Turkish postal address texts. Fix only spelling, diacritics, spacing and abbreviations. Never add, remove or change a street, neighbourhood, district, number or any other fact; keep phone numbers and notes as they are. If the text is already fine, return it unchanged. Answer JSON.';
const SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } as const;

async function solved(search: Search, text: string, truth: LngLat): Promise<boolean> {
  const result = await search.resolve(text);
  const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
  return !!best && distanceM(best.coordinate, truth) <= NEAR_M;
}

export type RewriteReport = { failed: number; fixed: number; fixedByAgreement: number; fine: number; broken: number; brokenByAgreement: number; changedFine: number };

export async function runRewrite(): Promise<{ report: RewriteReport; text: string }> {
  const search = await openSearch(undefined, false, PLATES);
  const failed: TextRecord[] = [];
  const fine: TextRecord[] = [];
  for (const plate of PLATES) {
    for (const r of shuffle(readSet<TextRecord>('g2', plate).filter((x) => x.source === 'osm'), rng(6161 + Number(plate))).slice(0, 600)) {
      const ok = await solved(search, r.text, [r.lng, r.lat]);
      if (!ok && failed.length < FAILED * (PLATES.indexOf(plate) + 1) / PLATES.length) failed.push(r);
      if (ok && fine.length < FINE * (PLATES.indexOf(plate) + 1) / PLATES.length) fine.push(r);
    }
  }
  const rewritten = new Map<string, string[]>();
  for (const model of MODELS) {
    for (const r of [...failed, ...fine]) {
      const got = await ask<{ text: string }>(model, SYSTEM, r.text, SCHEMA, { numPredict: 160 });
      rewritten.set(r.id, [...(rewritten.get(r.id) ?? []), (got?.text ?? r.text).trim()]);
    }
  }
  let fixed = 0;
  let fixedByAgreement = 0;
  let broken = 0;
  let brokenByAgreement = 0;
  let changedFine = 0;
  for (const r of failed) {
    const [a = r.text, b = r.text] = rewritten.get(r.id) ?? [];
    const okA = a !== r.text && (await solved(search, a, [r.lng, r.lat]));
    const okB = b !== r.text && (await solved(search, b, [r.lng, r.lat]));
    if (okA || okB) fixed++;
    if (okA && okB && a === b) fixedByAgreement++;
  }
  for (const r of fine) {
    const [a = r.text, b = r.text] = rewritten.get(r.id) ?? [];
    if (a !== r.text || b !== r.text) changedFine++;
    const badA = a !== r.text && !(await solved(search, a, [r.lng, r.lat]));
    const badB = b !== r.text && !(await solved(search, b, [r.lng, r.lat]));
    if (badA || badB) broken++;
    if (badA && badB && a === b) brokenByAgreement++;
  }
  const report: RewriteReport = { failed: failed.length, fixed, fixedByAgreement, fine: fine.length, broken, brokenByAgreement, changedFine };
  const pct = (n: number, d: number): string => `%${((100 * n) / Math.max(1, d)).toFixed(1)}`;
  const text = ['# Sorgu yeniden yazma (yerel model, yalnız derleme zamanı değerlendirmesi)', '', `SDK'da çevrimdışı model yoktur; bu bir ölçümdür. ${PLATES.join(', ')} illerinin G2 metinleri. Başarısız: ilk sonuç gerçek noktadan ${NEAR_M} m'den uzak ya da yok (${failed.length} metin). Sağlam: ilk sonuç ${NEAR_M} m içinde (${fine.length} metin). Modeller ${MODELS.join(' ve ')}; model yalnız yazım, aksan ve boşluk düzeltir.`, '', '| Ölçü | Sonuç |', '|---|---|', `| Başarısız metinlerden düzelen (en az bir model) | ${fixed} / ${failed.length} (${pct(fixed, failed.length)}) |`, `| İki modelin aynı yeniden yazımıyla düzelen | ${fixedByAgreement} / ${failed.length} (${pct(fixedByAgreement, failed.length)}) |`, `| Sağlam metinlerde yeniden yazılan | ${changedFine} / ${fine.length} (${pct(changedFine, fine.length)}) |`, `| Sağlam metinlerde bozulan (en az bir model) | ${broken} / ${fine.length} (${pct(broken, fine.length)}) |`, `| İki modelin aynı yeniden yazımıyla bozulan | ${brokenByAgreement} / ${fine.length} (${pct(brokenByAgreement, fine.length)}) |`, '', `Yorum: başarısız metinlerin ${pct(fixed, failed.length)}'i düzeldi, sağlam metinlerin ${pct(broken, fine.length)}'i bozuldu (iki modelin ortak yazımında ${fixedByAgreement} düzelen, ${brokenByAgreement} bozulan). Kazanç küçük ve risk var; bu yüzden yeniden yazma SDK'ya ve pakete girmez, çözümleyici kuralları için ipucu olarak kalır.`, ''].join('\n');
  return { report, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRewrite().then(({ report, text }) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16b-yeniden-yazma.md'), text);
    console.log(JSON.stringify(report));
  });
}
