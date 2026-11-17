import { ed25519 } from '@noble/curves/ed25519';
import { parseManifest, type FileKind, type Manifest, type ManifestFile, type ManifestRegion } from '../region/manifest';
import { base64Decode, utf8Bytes } from './base64';

export type VerifyFailure = 'signature' | 'malformed' | 'manifest-newer' | 'sdk-too-old';
export type VerifyResult = { ok: true; manifest: Manifest } | { ok: false; code: VerifyFailure };

const SPKI_PREFIX = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
const VERSION = /^\d+\.\d+\.\d+$/;
export const MAX_MANIFEST_FORMAT = 2;

function publicKeyBytes(key: string): Uint8Array | null {
  const body = key.replace(/-----[^-]+-----/g, '');
  const bytes = base64Decode(body);
  if (!bytes) return null;
  if (bytes.length === 32) return bytes;
  if (bytes.length === 44 && SPKI_PREFIX.every((b, i) => bytes[i] === b)) return bytes.slice(12);
  return null;
}

export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = left[i] ?? 0;
    const y = right[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function signatureHolds(text: string, signature: string, publicKeys: string[]): boolean {
  const sig = base64Decode(signature);
  if (!sig || sig.length !== 64) return false;
  const message = utf8Bytes(text);
  for (const key of publicKeys) {
    const bytes = publicKeyBytes(key);
    if (!bytes) continue;
    try {
      if (ed25519.verify(sig, message, bytes)) return true;
    } catch {
      continue;
    }
  }
  return false;
}

function looksLikeObject(text: string): boolean {
  try {
    const raw: unknown = JSON.parse(text);
    return raw !== null && typeof raw === 'object' && !Array.isArray(raw);
  } catch {
    return false;
  }
}

export function inspectManifest(text: string, sdkVersion: string): VerifyResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, code: 'malformed' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'malformed' };
  const { format, minSdk } = raw as { format?: unknown; minSdk?: unknown };
  if (typeof format === 'number' && format > MAX_MANIFEST_FORMAT) return { ok: false, code: 'manifest-newer' };
  if (typeof minSdk === 'string' && VERSION.test(minSdk) && compareVersions(minSdk, sdkVersion) > 0) return { ok: false, code: 'sdk-too-old' };
  try {
    return { ok: true, manifest: parseManifest(text) };
  } catch {
    return { ok: false, code: 'malformed' };
  }
}

export function verifyManifest(input: { text: string; signature: string; publicKeys: string[]; sdkVersion: string }): VerifyResult {
  const shape = inspectManifest(input.text, input.sdkVersion);
  if (!shape.ok && shape.code === 'malformed' && !looksLikeObject(input.text)) return shape;
  if (!signatureHolds(input.text, input.signature, input.publicKeys)) return { ok: false, code: 'signature' };
  return shape;
}

export type ManifestDiff = { added: string[]; removed: string[]; changed: { id: string; kinds: FileKind[] }[]; baseChanged: boolean };

const fingerprint = (file: ManifestFile): string => `${file.path}:${file.sha256}`;

function changedKinds(old: ManifestRegion, next: ManifestRegion): FileKind[] {
  const before = new Map(old.files.map((f) => [f.kind, fingerprint(f)]));
  const after = new Map(next.files.map((f) => [f.kind, fingerprint(f)]));
  const kinds = new Set<FileKind>([...before.keys(), ...after.keys()]);
  return [...kinds].filter((kind) => before.get(kind) !== after.get(kind)).sort();
}

export function diffManifest(old: Manifest, next: Manifest): ManifestDiff {
  const before = new Map(old.regions.map((r) => [r.id, r]));
  const after = new Map(next.regions.map((r) => [r.id, r]));
  const changed: ManifestDiff['changed'] = [];
  for (const [id, region] of after) {
    const previous = before.get(id);
    if (!previous) continue;
    const kinds = changedKinds(previous, region);
    if (kinds.length > 0) changed.push({ id, kinds });
  }
  const baseOf = (m: Manifest): string => m.base.map(fingerprint).sort().join('|');
  return {
    added: [...after.keys()].filter((id) => !before.has(id)).sort(),
    removed: [...before.keys()].filter((id) => !after.has(id)).sort(),
    changed: changed.sort((a, b) => (a.id < b.id ? -1 : 1)),
    baseChanged: baseOf(old) !== baseOf(next),
  };
}
