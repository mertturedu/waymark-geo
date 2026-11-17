export type InstallFile = { path: string; size: number; sha256: string };
export type InstallManifest = { protomapsBuild: string; files: InstallFile[] };

const SKIPPED = new Set(['blob-30mb.bin']);

export function pickInstallFiles(manifest: InstallManifest): InstallFile[] {
  return manifest.files.filter((f) => !SKIPPED.has(f.path)).sort((a, b) => a.size - b.size || a.path.localeCompare(b.path));
}

export function progressLine(index: number, count: number, path: string, done: number, total: number): string {
  const percent = total > 0 ? Math.floor((100 * done) / total) : 0;
  return `${index + 1}/${count} ${path} %${percent}`;
}

export function missingFiles(manifest: InstallManifest, sizeOf: (path: string) => number | null): number {
  return pickInstallFiles(manifest).filter((f) => sizeOf(f.path) !== f.size).length;
}
