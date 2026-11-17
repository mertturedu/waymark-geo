import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPacks } from '../../scripts/verify-packs';

const dir = () => mkdtempSync(join(tmpdir(), 'vp-'));

describe('checkPacks', () => {
  it('fails clearly when the manifest, signature or key is missing', async () => {
    const result = await checkPacks(dir());
    expect(result).toEqual({ ok: false, files: 0, problems: ['manifest, imza ya da genel anahtar yok'] });
  });

  it('fails when the signature does not hold', async () => {
    const d = dir();
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'manifest-v1.json'), '{"format":1}');
    writeFileSync(join(d, 'manifest-v1.json.sig'), 'AAAA');
    writeFileSync(join(d, 'dev-public-key.pem'), '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n');
    const result = await checkPacks(d);
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('manifest doğrulanamadı');
  });

  it('is happy with the real development packs when they are built', async () => {
    const real = join(__dirname, '../../dist/packs');
    const built = (await import('node:fs')).existsSync(join(real, 'manifest-v1.json'));
    if (!built) return;
    const result = await checkPacks(real, ['34']);
    expect(result.problems).toEqual([]);
    expect(result.files).toBeGreaterThan(0);
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });

  it('names an il that the manifest does not know', async () => {
    const real = join(__dirname, '../../dist/packs');
    if (!(await import('node:fs')).existsSync(join(real, 'manifest-v1.json'))) return;
    const result = await checkPacks(real, ['99']);
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('99');
  });
});
