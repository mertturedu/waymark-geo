import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Gate, GateContext } from './engine';
import { readReports } from './phase-5';

const tail = (out: string): string => out.trim().split('\n').slice(-3).join(' / ');

const lastJson = (out: string): { measured?: string } | null => {
  for (const line of out.trim().split('\n').reverse()) {
    try {
      const parsed = JSON.parse(line) as { measured?: string };
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch {
      continue;
    }
  }
  return null;
};

const auto = (id: string, title: string, threshold: string, measure: Gate['measure']): Gate => ({ id, phase: 7, title, kind: 'auto', threshold, measure });

export const PLAN_MUTATION_CONFIG = 'stryker.plan.config.json';

const planCheck = (name: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['tsx', 'scripts/measure-plan.ts', '--check', name]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: lastJson(out)?.measured ?? tail(out) };
};

const tests = (files: string[], name?: string) => async ({ run }: GateContext) => {
  const { code, out } = await run('npx', ['jest', ...files, ...(name ? ['-t', name] : [])]);
  return { status: code === 0 ? ('pass' as const) : ('fail' as const), measured: /Tests:\s+(.*)/.exec(out)?.[1] ?? tail(out) };
};

const deviceEntries = (ids: string[], label: string): Gate['measure'] => async ({ reportDir }) => {
  const reports = readReports(reportDir).filter((r) => r.device.os.toLowerCase().startsWith('ios') && r.sdk.build === 'release');
  if (reports.length === 0) return { status: 'open', measured: `${label}: Release cihaz raporu yok` };
  const report = reports[reports.length - 1];
  const missing = ids.filter((id) => report?.entries.find((e) => e.id === id)?.outcome !== 'pass');
  return missing.length === 0 ? { status: 'pass', measured: `${label}: ${ids.join(', ')} geçti` } : { status: 'fail', measured: `${label}: geçmeyen ${missing.join(', ')}` };
};

export const phase7Gates: Gate[] = [
  auto('K7.1', 'Kesin çözücü (12 durağa kadar)', 'gerçek İstanbul ve Balıkesir matrislerinde 2.000 örnek (yarısı kısıtlı): sonuç kaba kuvvetle bulunan en iyiye eşit (yüzde 100); çelişkili kurallar CONSTRAINT_CONFLICT', planCheck('exact')),
  auto('K7.2', 'Sezgisel çözücü ve OR-Tools', '13-100 durak, 300 örnek: ortalama fark en çok yüzde 1,5, en kötü en çok yüzde 5; 50 durak en çok 1 sn, 100 durak en çok 3 sn; en yakın komşudan hiçbir örnekte kötü değil', async (ctx) => {
    if (!existsSync(join(ctx.repoRoot, 'dist', 'work', 'plan', 'ortools.json'))) return { status: 'open', measured: 'OR-Tools çıktısı yok (pipeline/verify/plan_ortools.py)' };
    return planCheck('reference')(ctx);
  }),
  auto('K7.3', 'Kısıt özellikleri', '10 bin rastgele istek: başlangıç ilk, sabit bitiş sonda, dönüşte tur kapanır, sabitleme yerinde, alış teslimden önce, çelişki ancak gerçekten çelişkiliyse, gidilmişler yok, permütasyon, toplam bacakların toplamı, keep sırayı korur', tests(['test/plan/properties.test.ts'])),
  auto('K7.4', 'Hiçbir durak sessizce düşmez', 'ulaşılamayan, il dışı ve bağlantısız duraklar nedeniyle unreachable içinde döner', tests(['test/plan/plan.test.ts'], 'never drops a stop silently')),
  auto('K7.5', 'Belirlenim ve giriş sırasından bağımsızlık', 'aynı girdi aynı sırayı verir; giriş sırası ters çevrilince toplam süre aynı', planCheck('legs')),
  auto('K7.6', 'Kalanları yeniden sıralama', 'mevcut konumdan başlar, gidilenleri dışarıda bırakır, sabitlemelere uyar', tests(['test/plan/plan.test.ts'], 'visited stops out')),
  auto('K7.7', 'Bacak sürekliliği', 'her bacak öncekinin bittiği noktada 1 m içinde başlar (gerçek yol ağında)', planCheck('legs')),
  auto('K7.8', 'En yakın komşudan kötü değil', 'kısıtsız örneklerde sonuç en yakın komşu sonucundan kötü değildir; giriş sırasına göre kazanç raporlanır', async (ctx) => {
    if (!existsSync(join(ctx.repoRoot, 'dist', 'work', 'plan', 'ortools.json'))) return { status: 'open', measured: 'K7.2 çıktısı yok' };
    return planCheck('reference')(ctx);
  }),
  auto('K7.9', 'Kenar durumları', '0, 1, hepsi aynı nokta, 100 durak, 101 durak (TOO_MANY_STOPS), başlangıç durakla aynı, bitiş başlangıçla aynı', tests(['test/plan/plan.test.ts'])),
  auto('K7.10', 'Mutasyon ve kapsam', 'plan çekirdeğinde mutasyon en az yüzde 80; kapsam en az yüzde 90', async ({ run }) => {
    const mutation = await run('npx', ['stryker', 'run', PLAN_MUTATION_CONFIG]);
    const score = /All files\s*\|\s*([\d.]+)/.exec(mutation.out)?.[1];
    const coverage = await run('npx', ['jest', '--coverage', '--silent']);
    return { status: mutation.code === 0 && coverage.code === 0 ? 'pass' : 'fail', measured: `plan mutasyonu ${score ?? tail(mutation.out)}; kapsam eşikleri ${coverage.code === 0 ? 'geçti' : 'tutmadı'}` };
  }),
  { id: 'K7.11', phase: 7, title: 'Cihaz: 30 duraklı sıralama', kind: 'device', allowOpen: true, threshold: 'iPhone Release: 30 durak sıralanır ve bacaklar çizilir 3 sn altında; sabitleme ve alış-teslim kuralları tutar; elle sıra ve kalanları sırala çalışır', measure: deviceEntries(['sdk.plan-thirty', 'sdk.plan-keep'], 'plan') },
  auto('K7.12', 'Rozet kümesi tutarlı', 'chains.json ile PNG, kayıt, stil ve lejant tutarlı; her zincir kendi adını tanır', async ({ run }) => {
    const js = await run('npx', ['jest', 'test/map']);
    const py = await run('pipeline/.venv/bin/pytest', ['pipeline/tests/test_chains.py', '-q']);
    return { status: js.code === 0 && py.code === 0 ? 'pass' : 'fail', measured: `${/Tests:\s+(.*)/.exec(js.out)?.[1] ?? tail(js.out)}; ${tail(py.out)}` };
  }),
  auto('K7.13', 'Zincir ve bilindik yer verisi', 'Python testleri geçer; 81 il işletme katmanı en çok 125 MB', async ({ run, repoRoot }) => {
    const py = await run('pipeline/.venv/bin/pytest', ['pipeline/tests', '-q']);
    let size = 0;
    try {
      const manifest = JSON.parse(readFileSync(join(repoRoot, 'dist', 'packs', 'manifest-v1.json'), 'utf8')) as { regions: { files: { kind: string; size: number }[] }[] };
      size = manifest.regions.flatMap((r) => r.files).filter((f) => f.kind === 'places').reduce((a, f) => a + f.size, 0);
    } catch {
      size = 0;
    }
    const mb = size / 1e6;
    return { status: py.code === 0 && mb > 0 && mb <= 125 ? 'pass' : 'fail', measured: `${tail(py.out)}; işletme katmanı ${mb.toFixed(1)} MB` };
  }),
  { id: 'K7.14', phase: 7, title: 'Zincir konum denetimi', kind: 'decision', allowOpen: true, threshold: 'karo gidiş-dönüşü en çok 1 m; kanıtlı nokta payı büyük şehirlerde (İstanbul, Ankara) en az yüzde 95; ülke geneli yüzde 97 eşiği yazılı onay bekliyor', async measure({ reportDir }) {
    const file = join(reportDir, 'zincir-konum-denetimi.md');
    if (!existsSync(file)) return { status: 'open', measured: 'rapor yok (pipeline/verify/chain_positions.py)' };
    const text = readFileSync(file, 'utf8');
    const rows = [...text.matchAll(/^\| (34|06) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|/gm)];
    const shares = rows.map((m) => ((Number(m[3]) + Number(m[4])) / Number(m[2])) * 100);
    const tile = /en büyük sapma ([\d.]+) m/.exec(text)?.[1];
    const total = /kanıtlı pay %([\d.]+)/.exec(text)?.[1];
    const ok = shares.length === 2 && shares.every((v) => v >= 95) && tile !== undefined && Number(tile) <= 1;
    return { status: ok ? 'pass' : 'fail', measured: `İstanbul/Ankara kanıtlı pay %${shares.map((v) => v.toFixed(1)).join(' ve %')}; karo sapması ${tile ?? '?'} m; ülke geneli %${total ?? '?'} (yüzde 97 eşiği onay bekliyor)` };
  } },
  { id: 'K7.15', phase: 7, title: 'Cihaz: ağsız arama ve rota', kind: 'device', allowOpen: true, threshold: 'ağ kapısı kapalı SDK ile kapı çözme, öneri ve rota sonuç verir (sdk.offline-search)', measure: deviceEntries(['sdk.offline-search'], 'ağsız') },
];
