import { Directory, File } from 'expo-file-system';
import { createExpoFs, createExpoNet } from '../../../../src/native';
import type { FsPort, NetPort } from '../../../../src/core/packs/ports';
import { installWith, systemClock } from '../install';
import { pickInstallFiles, progressLine } from '../install-list';
import { saveManifest } from '../storage';
import { nativeFsHash } from './native-hash';
import type { TestContext } from '../types';

export type { InstallFile as ManifestFile, InstallManifest as Manifest } from '../install-list';
import type { InstallFile as ManifestFile, InstallManifest as Manifest } from '../install-list';

export async function fetchManifest(serverUrl: string): Promise<Manifest> {
  const response = await fetch(`${serverUrl}/manifest.json`);
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
  return (await response.json()) as Manifest;
}

export const packFile = (ctx: TestContext, path: string): File => new File(`${ctx.packsDir.replace(/\/$/, '')}/${path}`);

export async function installFile(
  ctx: TestContext,
  file: ManifestFile,
  options: { wrapFs?: (fs: FsPort) => FsPort; wrapNet?: (net: NetPort) => NetPort; onProgress?: (done: number, total: number) => void; to?: string } = {},
): Promise<{ bytes: number; retries: number }> {
  const fs = createExpoFs(new Directory(ctx.packsDir));
  const net = createExpoNet();
  return installWith(
    { fs: options.wrapFs ? options.wrapFs(fs) : fs, net: options.wrapNet ? options.wrapNet(net) : net, hash: nativeFsHash(fs), clock: systemClock },
    ctx.packServerUrl,
    file,
    { ...(options.onProgress ? { onProgress: options.onProgress } : {}), ...(options.to ? { to: options.to } : {}) },
  );
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
