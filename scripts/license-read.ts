import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ask } from '../tools/ollama';
import { repoRoot } from './addr-sets';
import { getText } from './municipal-harvest';
import { htmlToText, hoodKey } from './municipal-lib';

export type Reading = { license: string; portal: string; url: string | null; commercial: string; redistribution: string; derivatives: string; attribution: boolean; summary: string; quote: string; quoteFound: boolean };

const MODEL = 'qwen3:14b';
const base = join(repoRoot, 'dist', 'municipal', 'opendata');
const SCHEMA = {
  type: 'object',
  properties: {
    commercial: { type: 'string', enum: ['evet', 'hayır', 'belirsiz'] },
    redistribution: { type: 'string', enum: ['evet', 'hayır', 'belirsiz'] },
    derivatives: { type: 'string', enum: ['evet', 'hayır', 'belirsiz'] },
    attribution: { type: 'boolean' },
    summary: { type: 'string' },
    quote: { type: 'string' },
  },
  required: ['commercial', 'redistribution', 'derivatives', 'attribution', 'summary', 'quote'],
} as const;
const SYSTEM =
  'Bir açık veri lisansı metnini oku. commercial=veri ticari ürün ya da hizmette kullanılabilir mi; redistribution=veri ya da türevi başkalarına (ör. uygulama paketi içinde) dağıtılabilir mi; derivatives=veriden türev çalışma yapılabilir mi. Metin açıkça söylemiyorsa "belirsiz" yaz, tahmin etme. attribution=kaynak gösterme şartı var mı. summary=en çok iki cümle Türkçe. quote=kararı dayandırdığın cümleyi metinden BİREBİR kopyala (yoksa boş bırak).';

export async function licenseUrl(portal: string, id: string): Promise<string | null> {
  const body = await getText(`https://${portal}/api/3/action/license_list`);
  if (!body) return null;
  try {
    const list = (JSON.parse(body) as { result?: { id: string; url?: string }[] }).result ?? [];
    const url = list.find((l) => l.id === id)?.url;
    return url ? new URL(url, `https://${portal}/`).toString() : null;
  } catch {
    return null;
  }
}

export async function readLicense(portal: string, id: string): Promise<Reading> {
  const url = await licenseUrl(portal, id);
  const html = url ? await getText(url) : null;
  const text = html ? htmlToText(html).slice(0, 12000) : '';
  const empty: Reading = { license: id, portal, url, commercial: 'belirsiz', redistribution: 'belirsiz', derivatives: 'belirsiz', attribution: false, summary: text ? '' : 'Lisans sayfası açılmıyor ya da yok; belediyeden yazılı izin gerekir.', quote: '', quoteFound: false };
  if (!text) return empty;
  const out = await ask<Omit<Reading, 'license' | 'portal' | 'url' | 'quoteFound'>>(MODEL, SYSTEM, text, SCHEMA, { numPredict: 500 }).catch(() => null);
  if (!out) return { ...empty, summary: 'Model cevap vermedi.' };
  const found = out.quote !== '' && hoodKey(text).includes(hoodKey(out.quote));
  return { license: id, portal, url, commercial: found ? out.commercial : 'belirsiz', redistribution: found ? out.redistribution : 'belirsiz', derivatives: found ? out.derivatives : 'belirsiz', attribution: out.attribution, summary: out.summary, quote: out.quote, quoteFound: found };
}

export function renderLicenses(list: Reading[]): string {
  const rows = list.map((r) => `| ${r.license} | ${r.portal} | ${r.commercial} | ${r.redistribution} | ${r.derivatives} | ${r.attribution ? 'evet' : 'hayır'} | ${r.summary.replace(/\|/g, '/')} | ${r.url ? `[metin](${r.url})` : '-'} |`).join('\n');
  return `# Lisans okuma (qwen özeti, karar sizde)\n\nModel yalnız metinden alıntı verebildiği kararı yazar; alıntı bulunamazsa "belirsiz" kalır. Onaylamak için lisans kimliğini \`dist/municipal/opendata/approved-licenses.json\` listesine ekleyin; çekme modu o veri setlerini alır.\n\n| Lisans | Portal | Ticari | Dağıtım | Türev | Kaynak göster | Özet | Metin |\n|---|---|---|---|---|---|---|---|\n${rows}\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = join(base, 'state.json');
  const state = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { entries: { portal: string; license: string | null; status: string }[] }) : { entries: [] };
  const wanted = new Map<string, string>();
  for (const e of state.entries) if (e.license && e.status.startsWith('lisans') && !wanted.has(e.license)) wanted.set(e.license, e.portal);
  const readings: Reading[] = [];
  for (const [id, portal] of wanted) readings.push(await readLicense(portal, id));
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'licenses.json'), JSON.stringify(readings));
  const out = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'lisanslar.md');
  writeFileSync(out, renderLicenses(readings));
  console.log(renderLicenses(readings));
}
