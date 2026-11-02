export const PACK_ERROR_CODES = ['network', 'no-space', 'checksum', 'signature', 'http-404', 'http', 'malformed', 'manifest-newer', 'sdk-too-old', 'cancelled', 'storage'] as const;

export type PackErrorCode = (typeof PACK_ERROR_CODES)[number];

export type PackError = Error & { code: PackErrorCode };

export function packError(code: PackErrorCode, message?: string): PackError {
  return Object.assign(new Error(message ?? code), { code });
}

export function isPackError(value: unknown): value is PackError {
  return value instanceof Error && typeof (value as { code?: unknown }).code === 'string';
}
