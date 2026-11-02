import { fetch as streamingFetch } from 'expo/fetch';
import { Directory, File, Paths } from 'expo-file-system';
import { download, type Store } from '../../../../scripts/spikes/resume-download';
import { FileStore } from './fileStore';
import { pickInstallFiles, progressLine } from '../install-list';
import { saveManifest } from '../storage';
import { uiYielder } from '../ui-yield';
import { nativeStoreSha256 } from './native-hash';
import type { TestContext } from '../types';

export type { InstallFile as ManifestFile, InstallManifest as Manifest } from '../install-list';
import type { InstallFile as ManifestFile, InstallManifest as Manifest } from '../install-list';

export const fetchImpl = streamingFetch as unknown as typeof fetch;

export async function fetchManifest(serverUrl: string): Promise<Manifest> {
  const response = await fetch(`${serverUrl}/manifest.json`);
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
  return (await response.json()) as Manifest;
}

export const packFile = (ctx: TestContext, path: string): File => new File(`${ctx.packsDir.replace(/\/$/, '')}/${path}`);

const partFor = (ctx: TestContext, path: string): File => new File(`${ctx.packsDir.replace(/\/$/, '')}/.part/${path.replace(/\//g, '__')}`);

export async function installFile(
  ctx: TestContext,
  file: ManifestFile,
  options: { wrapStore?: (store: Store) => Store; onProgress?: (done: number, total: number) => void; fetchImpl?: typeof fetch } = {},
): Promise<{ bytes: number; retries: number }> {
  const final = packFile(ctx, file.path);
  if (final.exists && final.size === file.size) return { bytes: file.size, retries: 0 };
  const parent = new Directory(final.uri.slice(0, final.uri.lastIndexOf('/')));
  if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
  const part = partFor(ctx, file.path);
  const store = new FileStore(part);
  try {
    const result = await download({
      url: `${ctx.packServerUrl}/${file.path.split('/').map(encodeURIComponent).join('/')}`,
      store: options.wrapStore ? options.wrapStore(store) : store,
      sha256: file.sha256,
      fetchImpl: options.fetchImpl ?? fetchImpl,
      maxRetries: 5,
      freeBytes: async () => Paths.availableDiskSpace,
      yieldNow: uiYielder(),
      hashStore: nativeStoreSha256,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    store.close();
    const partSize = part.exists ? part.size : -1;
    if (partSize !== file.size) throw new Error(`indirilen parça eksik: ${partSize} / ${file.size} bayt`);
    if (final.exists) final.delete();
    await part.move(final);
    const finalSize = final.exists ? final.size : -1;
    if (finalSize !== file.size) throw new Error(`taşıma sonrası dosya eksik: ${finalSize} / ${file.size} bayt, parça ${part.exists ? part.size : 'yok'}`);
    return result;
  } finally {
    store.close();
  }
}

export async function installAll(ctx: TestContext, onStatus: (line: string) => void, shouldStop: () => boolean = () => false): Promise<{ files: number; retries: number }> {
  const manifest = await fetchManifest(ctx.packServerUrl);
  saveManifest(manifest);
  const files = pickInstallFiles(manifest);
  let retries = 0;
  for (let index = 0; index < files.length; index++) {
    if (shouldStop()) throw new Error('durduruldu');
    const file = files[index] as ManifestFile;
    onStatus(progressLine(index, files.length, file.path, 0, file.size));
    const result = await installFile(ctx, file, { onProgress: (done, total) => onStatus(progressLine(index, files.length, file.path, done, total)) });
    retries += result.retries;
  }
  return { files: files.length, retries };
}
