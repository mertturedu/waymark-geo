import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

export const SET_NAMES = ['g2', 'g7', 'g8'];
export const MIN_FIELD = 30;
const PHONE = /(?:\+?90[\s-]?)?0?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const TCKN = /\b[1-9]\d{10}\b/;

export type FieldText = { text?: string; note?: string };

export function personalHits(records: FieldText[]): string[] {
  const hits: string[] = [];
  for (const r of records) {
    const text = `${r.text ?? ''} ${r.note ?? ''}`;
    if (PHONE.test(text)) hits.push('telefon');
    if (EMAIL.test(text)) hits.push('e-posta');
    if (TCKN.test(text)) hits.push('kimlik no');
  }
  return hits;
}

export function readJsonDir<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const out: T[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const value = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
      if (Array.isArray(value)) out.push(...(value as T[]));
    } catch {
      continue;
    }
  }
  return out;
}

export function manifestProblems(repoRoot: string): string[] {
  const path = join(repoRoot, 'fixtures', 'addr-eval', 'MANIFEST.json');
  if (!existsSync(path)) return ['MANIFEST.json yok'];
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { data: string; files: Record<string, string> }>;
  const problems: string[] = [];
  for (const name of SET_NAMES) {
    const entry = manifest[name];
    if (!entry) {
      problems.push(`${name} yok`);
      continue;
    }
    const plates = Object.keys(entry.files);
    if (plates.length < 81) problems.push(`${name}: ${plates.length} il`);
    for (const plate of plates) {
      const file = join(repoRoot, 'dist', 'addr-eval', entry.data, name, `${plate}.json`);
      if (!existsSync(file)) {
        problems.push(`${name}/${plate} dosyası yok`);
        continue;
      }
      if (createHash('sha256').update(readFileSync(file, 'utf8')).digest('hex') !== entry.files[plate]) problems.push(`${name}/${plate} özeti tutmuyor`);
    }
  }
  return problems;
}

const fieldDir = (): string => join(homedir(), '.yuksi-geo', 'saha');
const realDir = (): string => join(homedir(), '.yuksi-geo', 'gercek');
const reportsDir = (): string => join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-olcum');

export const adres0Gates: Gate[] = [
  {
    id: 'A0.1',
    phase: 0,
    title: 'Saha ve gerçek veri dosyalarında kişisel bilgi yok (telefon, e-posta, kimlik no)',
    kind: 'auto',
    threshold: '0 bulgu',
    async measure() {
      const records = [...readJsonDir<FieldText>(fieldDir()), ...readJsonDir<FieldText>(realDir())];
      if (records.length === 0) return { status: 'open', measured: 'henüz saha ya da gerçek kayıt yok' };
      const hits = personalHits(records);
      return hits.length === 0 ? { status: 'pass', measured: `${records.length} kayıt, 0 bulgu` } : { status: 'fail', measured: `${hits.length} bulgu: ${[...new Set(hits)].join(', ')}` };
    },
  },
  {
    id: 'A0.2',
    phase: 0,
    title: 'Ölçüm setleri donduruldu (G2, G7, G8; 81 il; özetler tutuyor)',
    kind: 'auto',
    threshold: 'MANIFEST.json ile dosyalar birebir',
    async measure({ repoRoot }) {
      const problems = manifestProblems(repoRoot);
      return problems.length === 0 ? { status: 'pass', measured: `${SET_NAMES.length} set, 81 il` } : { status: 'fail', measured: problems.slice(0, 4).join('; ') };
    },
  },
  {
    id: 'A0.3',
    phase: 0,
    title: 'Taban ölçüm raporları yazıldı (G2 ipucusuz ve ipuçlu, G3, G7, G8)',
    kind: 'auto',
    threshold: 'beş rapor dosyası',
    async measure() {
      const dir = reportsDir();
      const names = existsSync(dir) ? readdirSync(dir) : [];
      const wanted = [/^g2-\d/, /^g2-ipuclu-/, /^g3-/, /^g7-/, /^g8-/];
      const missing = wanted.filter((re) => !names.some((n) => re.test(n))).map((re) => re.source.replace(/[\^\\d-]/g, ''));
      return missing.length === 0 ? { status: 'pass', measured: 'beş rapor var' } : { status: 'fail', measured: `eksik: ${missing.join(', ')}` };
    },
  },
  {
    id: 'A0.4',
    phase: 0,
    title: 'Telefonda adres tabanı testi (sdk.addr-baseline) iPhone ve Android\'de geçti (Node ile birebir)',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-baseline'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-baseline')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return outcome(ios) === 'pass' && outcome(android) === 'pass' ? { status: 'pass', measured } : { status: 'fail', measured };
    },
  },
  {
    id: 'A0.5',
    phase: 0,
    title: 'Kargoio teslim izi, kat ve konum kaynağı toplanıyor (backend ve kurye uygulaması)',
    kind: 'device',
    threshold: 'iki platformda deneme teslimi backend\'de trace ve floor ile görüldü',
    allowOpen: true,
    async measure() {
      return { status: 'open', measured: 'kod hazır; SQL operatörce çalıştırılmalı ve deneme teslimi yapılmalı' };
    },
  },
  {
    id: 'A0.6',
    phase: 0,
    title: `Saha seti (G0) toplanıyor: en az ${MIN_FIELD} kayıt`,
    kind: 'device',
    threshold: `≥ ${MIN_FIELD} kayıt`,
    async measure() {
      const records = readJsonDir<{ id: string }>(fieldDir());
      const unique = new Set(records.map((r) => r.id)).size;
      return unique >= MIN_FIELD ? { status: 'pass', measured: `${unique} kayıt` } : { status: 'open', measured: `${unique} kayıt` };
    },
  },
  {
    id: 'A0.7',
    phase: 0,
    title: 'Gerçekçi sentetik set (G1S) dil modeliyle üretildi (12 öncelikli il; kalan 69 il Faz 2\'de)',
    kind: 'auto',
    threshold: '12 ilde il başına ≥ 950 kayıt, 100 örnekte "insan gibi" ≥ %90',
    allowOpen: true,
    async measure({ repoRoot }) {
      const dir = join(repoRoot, 'dist', 'addr-eval');
      const versions = existsSync(dir) ? readdirSync(dir) : [];
      const counts = versions.flatMap((v) => {
        const sub = join(dir, v, 'g1s');
        return existsSync(sub) ? readdirSync(sub).filter((f) => f.endsWith('.json')).map((f) => (JSON.parse(readFileSync(join(sub, f), 'utf8')) as unknown[]).length) : [];
      });
      const ready = counts.filter((n) => n >= 950).length;
      const human = readMeasures().a0_7_human as { share: number } | undefined;
      const measured = `${ready}/12 il hazır${human ? `, insan gibi %${human.share}` : ', insan gibi değerlendirmesi yok'}`;
      if (ready < 12 || !human) return { status: 'open', measured };
      return { status: human.share >= 90 ? 'pass' : 'fail', measured };
    },
  },
];
