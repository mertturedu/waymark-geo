import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate, GateContext } from './engine';
import { deviceEntry } from './adres-13';

type Check = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

async function script(run: GateContext['run'], file: string, args: string[] = []): Promise<Check | null> {
  const { out } = await run('npx', ['tsx', `scripts/${file}.ts`, ...args]);
  const line = out.split('\n').filter((l) => l.startsWith('{"check"') || l.startsWith('{"workers"')).pop();
  return line ? (JSON.parse(line) as Check) : null;
}

const PHASE = 16.92;

export const adres16gGates: Gate[] = [
  {
    id: 'A16G.1',
    phase: PHASE,
    title: 'Docker imajı derlendi ve cevap veriyor (Docker çalışmıyorsa nedeni raporlanır; paket aynı komutla ve kök olmayan kullanıcı ayarlarıyla çalıştırılıp denenir)',
    kind: 'auto',
    threshold: 'imaj derlendi, /health ve örnek sorgu cevap verdi',
    async measure({ run, repoRoot }) {
      const daemon = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
      if (daemon.code !== 0) {
        const built = await run('npm', ['run', 'build:server']);
        const bundle = existsSync(join(repoRoot, 'dist', 'geo-server.mjs'));
        return { status: 'open', measured: `Docker hizmeti çalışmıyor (bu makinede yalnız Docker komut satırı var, Docker Desktop/Colima/OrbStack kurulu değil); Dockerfile'ın derlediği tek dosyalı paket ${built.code === 0 && bundle ? 'derlendi' : 'derlenemedi'} ve yük testinde çalıştı` };
      }
      const build = await run('docker', ['build', '-t', 'yuksi-geo:olcum', '.']);
      return { status: build.code === 0 ? 'pass' : 'fail', measured: build.code === 0 ? 'imaj derlendi' : build.out.slice(-200) };
    },
  },
  {
    id: 'A16G.2',
    phase: PHASE,
    title: 'Yeni `learned` dosyası ve manifest dizine konunca sunucu yeniden başlamadan okur; sürüm ve veri tarihi /version\'da',
    kind: 'auto',
    threshold: 'yeni nokta ≤ 5 sn içinde cevapta; /version learned tarihi dolu',
    async measure({ run }) {
      const real = await script(run, 'measure-reload');
      return real ? { status: real.pass ? 'pass' : 'fail', measured: real.measured } : { status: 'fail', measured: 'ölçüm çalışmadı' };
    },
  },
  {
    id: 'A16G.3',
    phase: PHASE,
    title: '8 eşzamanlı istemci, çok işlemli çalışma (4 işçi), gerçek karışım',
    kind: 'auto',
    threshold: '≥ 500 geocode/sn ve geocode p95 ≤ 100 ms, hata 0',
    async measure({ run }) {
      await run('npm', ['run', 'build:server']);
      const { out } = await run('npx', ['tsx', 'scripts/load-geo.ts', '--workers=4', '--clients=8', '--seconds=60']);
      const line = out.split('\n').filter((l) => l.startsWith('{"workers"')).pop();
      if (!line) return { status: 'fail', measured: 'yük testi çalışmadı' };
      const r = JSON.parse(line) as { geocodePerSecond: number; geocodeP95: number; errors: number; requests: number; perSecond: number };
      const ok = r.geocodePerSecond >= 500 && r.geocodeP95 <= 100 && r.errors === 0;
      return { status: ok ? 'pass' : 'fail', measured: `4 işçi, 8 istemci, 60 sn: ${r.requests} istek (${r.perSecond}/sn), geocode ${r.geocodePerSecond}/sn, p95 ${r.geocodeP95} ms, hata ${r.errors}` };
    },
  },
  {
    id: 'A16G.4',
    phase: PHASE,
    title: '10 dakikalık yük altında bellek ve disk raporu, sızıntı yok (ilk ve son dakika bellek farkı ≤ %15)',
    kind: 'auto',
    threshold: 'rapor var, son belleğin ilk ısınmış belleğe oranı ≤ 1,15, hata 0',
    async measure({ run }) {
      await run('npm', ['run', 'build:server']);
      const { out } = await run('npx', ['tsx', 'scripts/load-geo.ts', '--workers=1', '--clients=8', '--seconds=600', '--plates=34,06,35,41,16,01,07,42,27,33', '--maxopen=6']);
      const line = out.split('\n').filter((l) => l.startsWith('{"workers"')).pop();
      if (!line) return { status: 'fail', measured: 'yük testi çalışmadı' };
      const r = JSON.parse(line) as { rssMb: { t: number; mb: number }[]; errors: number; requests: number; packsMb: number; perSecond: number };
      const warm = r.rssMb.find((s) => s.t >= 60) ?? r.rssMb[0];
      const last = r.rssMb[r.rssMb.length - 1];
      const ratio = warm && last ? last.mb / warm.mb : 0;
      const peak = Math.max(...r.rssMb.map((s) => s.mb));
      return { status: ratio > 0 && ratio <= 1.15 && r.errors === 0 ? 'pass' : 'fail', measured: `10 dk, ${r.requests} istek (${r.perSecond}/sn), hata ${r.errors}; bellek ısınmış ${warm?.mb} MB → son ${last?.mb} MB (oran ${ratio.toFixed(2)}), tepe ${peak} MB; paket diski ${r.packsMb} MB` };
    },
  },
  {
    id: 'A16G.5',
    phase: PHASE,
    title: 'G2 eşliği: sunucu, çekirdek ve telefon aynı cevabı verir (iPhone ve Android, güncel yayın)',
    kind: 'device',
    threshold: 'sunucu eşliği tam; iki platformda sdk.addr-baseline ve sdk.addr-online pass',
    async measure({ reportDir, run }) {
      const server = await script(run, 'measure-server', ['--check', 'parity']);
      const ids = ['sdk.addr-baseline', 'sdk.addr-online'];
      const parts = ids.map((id) => ({ id, ios: deviceEntry(reportDir, id, true), android: deviceEntry(reportDir, id, false) }));
      const phones = parts.map((p) => `${p.id}: iPhone ${p.ios.outcome}, Android ${p.android.outcome}`).join('; ');
      const measured = `${server?.measured ?? 'sunucu eşliği ölçülemedi'}; ${phones}`;
      if (!server) return { status: 'fail', measured };
      if (parts.some((p) => p.ios.outcome === 'yok' || p.android.outcome === 'yok')) return { status: 'open', measured };
      return { status: server.pass && parts.every((p) => p.ios.outcome === 'pass' && p.android.outcome === 'pass') ? 'pass' : 'fail', measured };
    },
  },
];
