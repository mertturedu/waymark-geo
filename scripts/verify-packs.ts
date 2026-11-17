import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SDK_VERSION } from '../src/core';
import { decodedSha256 } from '../pipeline/validate/validate-packs';
import { verifyManifest } from '../src/core/packs/verify';

export type PackCheck = { ok: boolean; files: number; problems: string[] };

const sha256 = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

export async function checkPacks(dir: string, regions?: string[], options: { deep?: boolean } = {}): Promise<PackCheck> {
  const problems: string[] = [];
  const read = (name: string): string | null => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  const text = read('manifest-v1.json');
  const signature = read('manifest-v1.json.sig');
  const key = read('dev-public-key.pem');
  if (!text || !signature || !key) return { ok: false, files: 0, problems: ['manifest, imza ya da genel anahtar yok'] };
  const verified = verifyManifest({ text, signature: signature.trim(), publicKeys: [key.split('\n').filter((line) => !line.startsWith('-----')).join('')], sdkVersion: SDK_VERSION });
  if (!verified.ok) return { ok: false, files: 0, problems: [`manifest doğrulanamadı: ${verified.code}`] };
  const { manifest } = verified;
  const wanted = regions ? manifest.regions.filter((region) => regions.includes(region.id)) : manifest.regions;
  const files = [...(regions ? [] : manifest.base), ...wanted.flatMap((region) => region.files)];
  if (regions && wanted.length !== regions.length) problems.push(`manifestte olmayan il: ${regions.filter((id) => !wanted.some((region) => region.id === id)).join(', ')}`);
  for (const file of files) {
    const full = join(dir, file.path);
    if (!existsSync(full)) problems.push(`${file.path}: dosya yok`);
    else if (statSync(full).size !== file.size) problems.push(`${file.path}: boyut uyuşmuyor`);
    else if ((await sha256(full)) !== file.sha256) problems.push(`${file.path}: sha256 uyuşmuyor`);
    if (file.encoded) {
      const encodedFull = join(dir, file.encoded.path);
      if (!existsSync(encodedFull)) problems.push(`${file.encoded.path}: dosya yok`);
      else if (statSync(encodedFull).size !== file.encoded.size) problems.push(`${file.encoded.path}: boyut uyuşmuyor`);
      else if ((await sha256(encodedFull)) !== file.encoded.sha256) problems.push(`${file.encoded.path}: sha256 uyuşmuyor`);
      else if (options.deep && (await decodedSha256(encodedFull).catch(() => '')) !== file.sha256) problems.push(`${file.encoded.path}: zstd açılınca sha256 uyuşmuyor`);
    }
  }
  return { ok: problems.length === 0, files: files.length, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  const only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3].split(',') : undefined;
  const deep = process.argv.includes('--deep');
  if (!dir) {
    console.error('kullanım: npx tsx scripts/verify-packs.ts <paket klasörü> [il,il] [--deep]');
    process.exit(2);
  }
  checkPacks(dir, only, { deep }).then((result) => {
    console.log(JSON.stringify({ check: 'packs', pass: result.ok, measured: result.ok ? `imza geçerli, ${result.files} dosya boyut ve sha256 doğru` : result.problems.slice(0, 5).join(' / ') }));
    process.exit(result.ok ? 0 : 1);
  });
}
