import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDecision } from './decision';
import type { Gate, GateContext } from './engine';
import type { DeviceReport } from '../src/core/report/types';

const fromExit = (code: number, out: string) => ({ status: code === 0 ? ('pass' as const) : ('fail' as const), measured: code === 0 ? 'çıkış kodu 0' : `çıkış kodu ${code}: ${out.trim().split('\n').slice(-3).join(' / ')}` });

const decisionGate = (n: number): Gate => ({
  id: `K0.3-D${n}`,
  phase: 0,
  title: `Karar D${n}`,
  kind: 'decision',
  threshold: 'evet, kanıtıyla',
  async measure({ reportDir }) {
    let raw: string;
    try {
      raw = readFileSync(join(reportDir, 'faz-0-kararlar', `D${n}.json`), 'utf8');
    } catch {
      return { status: 'fail', measured: 'kanıt yok' };
    }
    try {
      const decision = parseDecision(JSON.parse(raw), `D${n}`);
      return decision.result === 'evet'
        ? { status: 'pass', measured: decision.summary }
        : { status: 'fail', measured: `hayır: ${decision.summary} (plan değişikliği gerekir)` };
    } catch (error) {
      return { status: 'fail', measured: `karar dosyası geçersiz: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
});

const readFolder = (dir: string): DeviceReport[] => {
  const reports: DeviceReport[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return reports;
  }
  for (const name of names.filter((f) => f.startsWith('cihaz-') && f.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, name), 'utf8')) as DeviceReport;
      if (Array.isArray(parsed.entries) && typeof parsed.device?.os === 'string' && typeof parsed.sdk?.build === 'string') reports.push(parsed);
    } catch {
      continue;
    }
  }
  return reports;
};

const readReports = (dir: string): DeviceReport[] => [...readFolder(dir), ...readFolder(join(dir, 'cihaz'))];

const REQUIRED = ['d1.map-offline', 'd1.net-state'];

const deviceGate = (id: string, title: string, osPrefix: string, allowOpen: boolean): Gate => ({
  id,
  phase: 0,
  title,
  kind: 'device',
  threshold: 'Release raporunda d1.map-offline ve d1.net-state geçti',
  allowOpen,
  async measure({ reportDir }: GateContext) {
    const reports = readReports(reportDir).filter((r) => r.device.os.startsWith(osPrefix));
    const ok = reports.find(
      (r) => r.sdk.build === 'release' && REQUIRED.every((req) => r.entries.some((e) => e.id === req && e.outcome === 'pass')),
    );
    if (ok) return { status: 'pass', measured: `rapor ${ok.reportId}` };
    const note = reports.length === 0 ? `${osPrefix} cihaz raporu yok` : `${reports.length} ${osPrefix} raporu var ama hiçbiri koşulu sağlamıyor`;
    return { status: allowOpen ? 'open' : 'fail', measured: note };
  },
});

export const phase0Gates: Gate[] = [
  {
    id: 'K0.1',
    phase: 0,
    title: 'npm run verify',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const { code, out } = await run('npm', ['run', 'verify']);
      return fromExit(code, out);
    },
  },
  {
    id: 'K0.2',
    phase: 0,
    title: 'Temizlik denetimi ve kendi testi',
    kind: 'auto',
    threshold: '0 bulgu, denetim testi geçer',
    async measure({ run }) {
      const scan = await run('node', ['../tools/geo-clean-check.mjs', '.']);
      if (scan.code !== 0) return fromExit(scan.code, scan.out);
      const self = await run('node', ['--test', '../tools/geo-clean-check.test.mjs']);
      return fromExit(self.code, self.out);
    },
  },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(decisionGate),
  deviceGate('K0.4a', 'iPhone çevrimdışı harita (Release)', 'iOS', false),
  deviceGate('K0.4b', 'Android çevrimdışı harita (Release)', 'Android', true),
  {
    id: 'K0.5',
    phase: 0,
    title: 'Rapor okuyucu testleri',
    kind: 'auto',
    threshold: 'çıkış kodu 0',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/report']);
      return fromExit(code, out);
    },
  },
];
