import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chainSummary, fix7Gates, OLD_GATES_BASELINE, passedCount } from '../../gates/fix-7';

const dir = () => mkdtempSync(join(tmpdir(), 'f7-'));
const ctx = (reportDir: string, out = '', code = 0) => ({ reportDir, repoRoot: '.', run: async () => ({ code, out }) });
const gate = (id: string) => fix7Gates.find((g) => g.id === id)!;
const table = (passed: number, failed = 2) => ['| Kapı | Başlık | Tür | Eşik | Ölçülen | Durum |', '|---|---|---|---|---|---|', ...Array.from({ length: passed }, (_, i) => `| K${i} | t | auto | e | m | GEÇTİ |`), ...Array.from({ length: failed }, (_, i) => `| X${i} | t | auto | e | m | KALDI |`)].join('\n');

describe('passedCount and chainSummary', () => {
  it('counts only the rows that passed', () => {
    expect(passedCount(table(5, 3))).toBe(5);
    expect(passedCount('')).toBe(0);
    expect(passedCount('| a | GEÇTİ ile başlayan | AÇIK |')).toBe(0);
  });

  it('reads the share, the tile deviation and the verdict', () => {
    const text = 'Toplam 10 nokta; kanıtlı pay %88.7 (adres kanıtı olmadan %88.6; eşik en az %97.0).\nKaro gidiş-dönüş: 22175 örnekte en büyük sapma 0.43 m\n\nSONUÇ: GEÇMEDİ\n';
    expect(chainSummary(text)).toEqual({ passed: false, share: '88.7', tile: '0.43' });
    expect(chainSummary('SONUÇ: GEÇTİ').passed).toBe(true);
    expect(chainSummary('')).toEqual({ passed: false, share: null, tile: null });
  });
});

describe('fix 7 gates', () => {
  it('runs jest then pytest and fails on either', async () => {
    const run = async (cmd: string) => ({ code: 0, out: cmd === 'npx' ? 'Tests: 50 passed' : '288 passed in 1s' });
    expect(await gate('KF7.1').measure({ reportDir: '.', repoRoot: '.', run })).toEqual({ status: 'pass', measured: '50 passed; pytest 288 passed' });
    expect((await gate('KF7.1').measure(ctx('.', 'boom', 1))).status).toBe('fail');
    const pytestFails = await gate('KF7.1').measure({ reportDir: '.', repoRoot: '.', run: async (cmd) => (cmd === 'npx' ? { code: 0, out: 'Tests: 1 passed' } : { code: 1, out: '1 failed' }) });
    expect(pytestFails.status).toBe('fail');
  });

  it('holds the old gates to their baseline', async () => {
    const d = dir();
    expect((await gate('KF7.2').measure(ctx(d))).status).toBe('open');
    writeFileSync(join(d, 'faz-8-kapilar.md'), table(OLD_GATES_BASELINE));
    expect((await gate('KF7.2').measure(ctx(d))).status).toBe('pass');
    writeFileSync(join(d, 'faz-8-kapilar.md'), table(OLD_GATES_BASELINE - 1));
    expect((await gate('KF7.2').measure(ctx(d))).status).toBe('fail');
  });

  it('keeps K7.14 open with the numbers when the threshold is not met and never lowers it', async () => {
    const d = dir();
    expect((await gate('KF7.3').measure(ctx(d))).status).toBe('open');
    writeFileSync(join(d, 'zincir-konum-denetimi.md'), 'kanıtlı pay %88.7 (eşik)\nen büyük sapma 0.43 m\nSONUÇ: GEÇMEDİ');
    const open = await gate('KF7.3').measure(ctx(d));
    expect(open.status).toBe('open');
    expect(open.measured).toContain('%88.7');
    expect(open.measured).toContain('eşik düşürülmedi');
    writeFileSync(join(d, 'zincir-konum-denetimi.md'), 'kanıtlı pay %98.1\nen büyük sapma 0.4 m\nSONUÇ: GEÇTİ');
    expect((await gate('KF7.3').measure(ctx(d))).status).toBe('pass');
  });

  it('reads the pack check from the last line and fails on a bad one', async () => {
    const good = await gate('KF7.4').measure(ctx('.', 'noise\n{"check":"packs","pass":true,"measured":"imza geçerli, 12 dosya"}', 0));
    expect(good).toEqual({ status: 'pass', measured: 'imza geçerli, 12 dosya' });
    expect((await gate('KF7.4').measure(ctx('.', '{"pass":false,"measured":"x: sha256 uyuşmuyor"}', 1))).status).toBe('fail');
    expect((await gate('KF7.4').measure(ctx('.', 'çöktü', 1))).measured).toBe('çöktü');
  });

  it('passes the cleanliness gate on empty output', async () => {
    expect((await gate('KF7.5').measure(ctx('.'))).status).toBe('pass');
    expect((await gate('KF7.5').measure(ctx('.', 'x: izli', 1))).status).toBe('fail');
  });
});
