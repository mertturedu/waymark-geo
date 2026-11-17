import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Gate } from './engine';

const PHASE = 18;

export const adres18Gates: Gate[] = [
  {
    id: 'A18.1',
    phase: PHASE,
    title: 'Yayında haftalık ölçüm otomatik koşuyor: iki ardışık yayın (.2 ve .3) için rapor, makine okunur kayıt ve farklılık kuyruğu üretiliyor; kapı önceki haftayla karşılaştırıyor; yayın akışı ölçümü çağırıyor; aylık kontrol kuru koşuyor',
    kind: 'auto',
    threshold: 'rapor + kayıt + kuyruk dosyaları var, ikinci hafta önceki haftayı tanıyor ve kapıdan geçiyor, data-release ölçümü çağırıyor, aylık kontrol Mapbox\'a göndermeden raporluyor',
    async measure({ run, repoRoot }) {
      const dir = mkdtempSync(join(tmpdir(), 'haftalik-'));
      const first = await run('npx', ['tsx', 'scripts/weekly.ts', '--tag', '20261028.20261030.2', '--plates', '34,06', '--cap', '60', '--out', dir]);
      const second = await run('npx', ['tsx', 'scripts/weekly.ts', '--tag', '20261028.20261030.3', '--plates', '34,06', '--cap', '60', '--out', dir]);
      const tag = '20261028.20261030.3';
      const files = [`${tag}.json`, `${tag}.md`, `farklilik-${tag}.md`].map((f) => existsSync(join(dir, f)));
      const report = files[1] ? readFileSync(join(dir, `${tag}.md`), 'utf8') : '';
      const release = readFileSync(join(repoRoot, 'scripts', 'data-release.ts'), 'utf8');
      const monthly = await run('npx', ['tsx', 'scripts/monthly.ts']);
      const ok = first.code === 0 && second.code === 0 && files.every(Boolean) && report.includes('önceki: 20261028.20261030.2') && report.includes('GEÇTİ') && release.includes("'scripts/weekly.ts'") && monthly.code === 0 && monthly.out.includes('Mapbox\'a hiçbir şey gönderilmedi');
      return { status: ok ? 'pass' : 'fail', measured: `ilk hafta çıkış ${first.code}, ikinci hafta çıkış ${second.code}; dosyalar ${files.filter(Boolean).length}/3; önceki hafta tanındı ${report.includes('önceki: 20261028.20261030.2')}; kapı GEÇTİ ${report.includes('GEÇTİ')}; yayın akışı ölçümü çağırıyor ${release.includes("'scripts/weekly.ts'")}; aylık kuru koşu ${monthly.code === 0}` };
    },
  },
  {
    id: 'A18.2',
    phase: PHASE,
    title: 'Gerileme benzetiminde yayın durdu: yayın paketinden sokakların 1/8\'i silinince ölçüm gerileme bulur ve yayın izni verilmez',
    kind: 'auto',
    threshold: 'gerileme ≥ 1 ve yayın durdu',
    async measure({ run }) {
      const { out } = await run('npx', ['tsx', 'scripts/weekly-simulate.ts']);
      const line = out.split('\n').filter((l) => l.startsWith('{"check"')).pop();
      if (!line) return { status: 'fail', measured: 'benzetim çalışmadı' };
      const result = JSON.parse(line) as { pass: boolean; measured: string };
      return { status: result.pass ? 'pass' : 'fail', measured: result.measured };
    },
  },
  {
    id: 'A18.3',
    phase: PHASE,
    title: 'Ölçüm kütüphanesi, yayın kapısı ve aylık kontrol testleri geçiyor',
    kind: 'auto',
    threshold: 'weekly-lib, data-release ve monthly testleri geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/scripts/weekly-lib.test.ts', 'test/scripts/data-release.test.ts', 'test/scripts/monthly.test.ts']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
  {
    id: 'A18.4',
    phase: PHASE,
    title: 'Mevcut testler gerilemedi (metin, adres, hat, paketler, öğrenme, sunucu, harita mantığı)',
    kind: 'auto',
    threshold: 'test/text, test/address, test/pipeline, test/packs, test/learned, test/real, test/scripts, test/server, test/geo, test/native geçiyor',
    async measure({ run }) {
      const { code, out } = await run('npx', ['jest', 'test/text', 'test/address', 'test/pipeline', 'test/packs', 'test/learned', 'test/real', 'test/scripts', 'test/server', 'test/geo', 'test/native']);
      const tail = out.split('\n').filter((l) => /^Tests:/.test(l)).pop() ?? '';
      return { status: code === 0 ? 'pass' : 'fail', measured: tail || (code === 0 ? 'geçti' : 'başarısız') };
    },
  },
];
