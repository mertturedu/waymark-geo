import type { Manifest, ManifestFile } from '../region/manifest';
import type { PackState } from './state-file';

export const finalPath = (path: string): string => `files/${path}`;
export const partPath = (path: string): string => `.part/${path.replace(/\//g, '__')}`;
export const encodedPaths = (file: ManifestFile): string[] => (file.encoded ? [finalPath(file.encoded.path), partPath(file.encoded.path)] : []);
export const patchPaths = (file: ManifestFile): string[] => (file.patches ?? []).flatMap((patch) => [finalPath(patch.path), partPath(patch.path)]);

export function installedPaths(state: PackState): Set<string> {
  const wanted = new Set<string>();
  for (const record of Object.values(state.regions)) for (const file of Object.values(record.files)) wanted.add(finalPath(file.path));
  for (const file of state.base?.files ?? []) wanted.add(finalPath(file.path));
  return wanted;
}

export function manifestPaths(manifest: Manifest | null, installed: Set<string>): Set<string> {
  const paths = new Set<string>();
  if (!manifest) return paths;
  const add = (file: ManifestFile): void => {
    paths.add(finalPath(file.path));
    if (file.encoded && !installed.has(finalPath(file.path))) paths.add(finalPath(file.encoded.path));
    for (const patch of file.patches ?? []) paths.add(finalPath(patch.path));
  };
  for (const file of manifest.base) add(file);
  for (const region of manifest.regions) for (const file of region.files) add(file);
  return paths;
}

export const partsOf = (finals: Set<string>): Set<string> => new Set([...finals].map((path) => partPath(path.slice('files/'.length))));
