import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readMeasures } from '../tools/compare/measures';
import type { Gate } from './engine';
import { uploadedReports } from './fix-0';

const MIN_WRONG_DISTRICT = 95;

type Groups = { groups: Record<string, { count: number; hood: number; district: number; within30: number }> };

const read = <T>(key: string): T | undefined => readMeasures()[key] as T | undefined;

export const adres3Gates: Gate[] = [
  {
    id: 'A3.1',
    phase: 3,
    title: 'G2 yanlış ilçe işlecinde mahalle doğru',
    kind: 'auto',
    threshold: `≥ %${MIN_WRONG_DISTRICT}`,
    async measure() {
      const m = read<Groups>('a3_new');
      const g = m?.groups.district_wrong;
      if (!g) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: g.hood >= MIN_WRONG_DISTRICT ? 'pass' : 'fail', measured: `${g.count} kayıt, mahalle doğru %${g.hood}, ilçe doğru %${g.district}` };
    },
  },
  {
    id: 'A3.2',
    phase: 3,
    title: 'Mahalle doğru oranı tabana göre arttı (G2 ve eski adlı G2A; geçici: G0 ve G1S yok)',
    kind: 'auto',
    threshold: 'her iki sette artış',
    allowOpen: true,
    async measure() {
      const base = read<Groups>('a3_base');
      const now = read<Groups>('a3_new');
      const aliasBase = read<Groups>('a3_g2a_base');
      const aliasNow = read<Groups>('a3_g2a_new');
      if (!base || !now || !aliasBase || !aliasNow) return { status: 'open', measured: 'taban ya da yeni ölçüm yok' };
      const g2 = [base.groups.tümü?.hood ?? 0, now.groups.tümü?.hood ?? 0];
      const g2a = [aliasBase.groups.tümü?.hood ?? 0, aliasNow.groups.tümü?.hood ?? 0];
      const measured = `G2 %${g2[0]} → %${g2[1]}; G2A (eski adlar) %${g2a[0]} → %${g2a[1]}`;
      return { status: (g2[1] as number) > (g2[0] as number) && (g2a[1] as number) > (g2a[0] as number) ? 'pass' : 'fail', measured };
    },
  },
  {
    id: 'A3.3',
    phase: 3,
    title: 'Mahalle bulmada SDK (dağınık metin), Nominatim\'e (temiz il/ilçe/mahalle sorgusu) göre eşit ya da iyi',
    kind: 'auto',
    threshold: 'SDK ≥ Nominatim',
    async measure() {
      const m = read<{ count: number; sdk: number; nominatim: number }>('a3_nominatim');
      if (!m) return { status: 'open', measured: 'ölçüm koşulmadı' };
      return { status: m.sdk >= m.nominatim ? 'pass' : 'fail', measured: `${m.count} kayıt; SDK %${m.sdk}, Nominatim %${m.nominatim}` };
    },
  },
  {
    id: 'A3.4',
    phase: 3,
    title: 'Mevcut altın küme (G6) ve metin ile adres testleri gerilemedi',
    kind: 'auto',
    threshold: 'test/text ve test/address geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A3.5',
    phase: 3,
    title: 'Mahalle sınırı kapsama raporu (81 il) yazıldı',
    kind: 'auto',
    threshold: 'rapor dosyası var, 81 il',
    async measure() {
      const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'adres-olcum');
      const has = existsSync(dir) && readdirSync(dir).some((f) => f.startsWith('mahalle-kapsama-'));
      const m = read<{ plates: number; hoods: number; polygonShare: number; addressHoodShare: number }>('a3_coverage');
      if (!has || !m) return { status: 'fail', measured: 'rapor yok' };
      return { status: m.plates >= 81 ? 'pass' : 'fail', measured: `${m.plates} il, ${m.hoods} mahalle, %${m.polygonShare} sınırlı, adreslerin %${m.addressHoodShare}'inde mahalle` };
    },
  },
  {
    id: 'A3.6',
    phase: 3,
    title: 'Telefonda idari çözüm testi (sdk.addr-admin) iPhone ve Android\'de geçti',
    kind: 'device',
    threshold: 'iki platformda pass',
    async measure({ reportDir }) {
      const reports = uploadedReports(reportDir).filter((r) => r.entries.some((e) => e.id === 'sdk.addr-admin'));
      const ios = reports.find((r) => /iPhone/i.test(r.device.model));
      const android = reports.find((r) => !/iPhone|iPad/i.test(r.device.model));
      const outcome = (r: (typeof reports)[number] | undefined): string => r?.entries.find((e) => e.id === 'sdk.addr-admin')?.outcome ?? 'yok';
      const measured = `iPhone ${outcome(ios)}, Android ${outcome(android)}`;
      if (!ios || !android) return { status: 'open', measured };
      return { status: outcome(ios) === 'pass' && outcome(android) === 'pass' ? 'pass' : 'fail', measured };
    },
  },
];
