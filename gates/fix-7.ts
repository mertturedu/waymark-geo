import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate } from './engine';

const UNIT_FILES = ['test/map/poi-glyphs.test.ts', 'test/scripts/glyph-audit.test.ts', 'test/scripts/verify-packs.test.ts', 'test/pipeline', 'test/gates/fix-7.test.ts'];
export const OLD_GATES_BASELINE = 74;
export const OLD_GATES_FILE = 'faz-8-kapilar.md';
export const CHAIN_REPORT = 'zincir-konum-denetimi.md';

export function passedCount(table: string): number {
  return table.split('\n').filter((line) => line.startsWith('|') && /\|\s*GEÇTİ\s*\|\s*$/.test(line)).length;
}

export function chainSummary(text: string): { passed: boolean; share: string | null; tile: string | null } {
  return { passed: /SONUÇ: GEÇTİ/.test(text), share: /kanıtlı pay %([\d.]+)/.exec(text)?.[1] ?? null, tile: /en büyük sapma ([\d.]+) m/.exec(text)?.[1] ?? null };
}

export const fix7Gates: Gate[] = [
  {
    id: 'KF7.1',
    phase: 7,
    title: 'F7 Python ve birim testleri (ad seçimi, simge denetimi, zincir kanıtı, paket doğrulama)',
    kind: 'auto',
    threshold: 'jest ve pytest çıkış kodu 0',
    async measure({ run }) {
      const unit = await run('npx', ['jest', ...UNIT_FILES]);
      const tests = /Tests:\s+(.*)/.exec(unit.out)?.[1] ?? '';
      if (unit.code !== 0) return { status: 'fail', measured: tests || unit.out.trim().split('\n').slice(-3).join(' / ') };
      const python = await run('sh', ['-c', 'cd pipeline && .venv/bin/pytest tests -q']);
      const py = /(\d+ passed)/.exec(python.out)?.[1] ?? '';
      return python.code === 0 ? { status: 'pass', measured: `${tests}; pytest ${py}` } : { status: 'fail', measured: `pytest: ${python.out.trim().split('\n').slice(-2).join(' / ')}` };
    },
  },
  {
    id: 'KF7.2',
    phase: 7,
    title: 'Faz 2-8 kapıları gerilemez (F7 sonrası koşu)',
    kind: 'auto',
    threshold: `faz-8-kapilar.md içinde en az ${OLD_GATES_BASELINE} GEÇTİ`,
    async measure({ reportDir }) {
      const file = join(reportDir, OLD_GATES_FILE);
      if (!existsSync(file)) return { status: 'open', measured: 'eski kapı koşusu yok' };
      const passed = passedCount(readFileSync(file, 'utf8'));
      return passed >= OLD_GATES_BASELINE ? { status: 'pass', measured: `${passed} GEÇTİ (taban ${OLD_GATES_BASELINE})` } : { status: 'fail', measured: `${passed} GEÇTİ, taban ${OLD_GATES_BASELINE}` };
    },
  },
  {
    id: 'KF7.3',
    phase: 7,
    title: 'K7.14 zincir konum denetimi ölçüldü (geçti ya da açık, eşik düşürülmez)',
    kind: 'decision',
    threshold: 'rapor var; eşik %97 yazılı kalır',
    async measure({ reportDir }) {
      const file = join(reportDir, CHAIN_REPORT);
      if (!existsSync(file)) return { status: 'open', measured: 'rapor yok (pipeline/verify/chain_positions.py)' };
      const summary = chainSummary(readFileSync(file, 'utf8'));
      const measured = `ülke geneli kanıtlı pay %${summary.share ?? '?'}, karo sapması ${summary.tile ?? '?'} m`;
      return summary.passed ? { status: 'pass', measured } : { status: 'open', measured: `${measured}; %97 eşiği tutmuyor, eşik düşürülmedi` };
    },
  },
  {
    id: 'KF7.4',
    phase: 7,
    title: 'İmza ve manifest doğrulaması (dist/packs)',
    kind: 'auto',
    threshold: 'imza geçerli; her dosyanın boyutu ve sha256 değeri manifestle aynı',
    async measure({ run }) {
      const result = await run('npx', ['tsx', 'scripts/verify-packs.ts', 'dist/packs']);
      const last = result.out.trim().split('\n').pop() ?? '';
      try {
        const parsed = JSON.parse(last) as { measured?: string };
        return { status: result.code === 0 ? 'pass' : 'fail', measured: parsed.measured ?? last };
      } catch {
        return { status: 'fail', measured: last || `çıkış kodu ${result.code}` };
      }
    },
  },
  {
    id: 'KF7.5',
    phase: 7,
    title: 'Temizlik denetimi',
    kind: 'auto',
    threshold: 'çıktı boş',
    async measure(ctx) {
      const result = await ctx.run('sh', ['-c', 'cd .. && node tools/geo-clean-check.mjs yuksi-geo']);
      return result.code === 0 && result.out.trim() === '' ? { status: 'pass', measured: 'temiz' } : { status: 'fail', measured: result.out.trim().split('\n').slice(0, 3).join(' / ') || `çıkış kodu ${result.code}` };
    },
  },
];
