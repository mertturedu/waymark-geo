import { downloadFile } from '../../../src/core/packs/download';
import { partPath } from '../../../src/core/packs/paths';
import type { ClockPort, FsPort, HashPort, NetPort } from '../../../src/core/packs/ports';
import type { InstallFile } from './install-list';

export type InstallPorts = { fs: FsPort; net: NetPort; hash: HashPort; clock: ClockPort };
export type InstallOptions = { onProgress?: (done: number, total: number) => void; to?: string };

export const systemClock: ClockPort = { now: () => Date.now(), sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

export const fileUrl = (serverUrl: string, path: string): string => `${serverUrl}/${path.split('/').map(encodeURIComponent).join('/')}`;

export function installWith(ports: InstallPorts, serverUrl: string, file: InstallFile, options: InstallOptions = {}): Promise<{ bytes: number; retries: number }> {
  const target = options.to ?? file.path;
  return downloadFile({ ...ports, url: fileUrl(serverUrl, file.path), partPath: partPath(target), finalPath: target, size: file.size, sha256: file.sha256, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
}

export function cuttingFs(inner: FsPort, failAfterBytes: number): FsPort & { readonly interrupted: boolean } {
  let written = 0;
  let cut = false;
  return {
    ...inner,
    get interrupted() {
      return cut;
    },
    async append(path, bytes) {
      written += bytes.length;
      if (!cut && written > failAfterBytes) {
        cut = true;
        throw new Error('simulated connection reset');
      }
      await inner.append(path, bytes);
    },
  };
}
