export const FALLBACK_SERVER = 'http://192.168.1.101:8090';

const PATTERN = /^(https?):\/\/([^\s/?#]+)(\/[^\s?#]*)?$/i;

export function normalizeServerUrl(input: string): string | null {
  const text = input.trim();
  if (text === '') return null;
  const match = PATTERN.exec(text.includes('://') ? text : `http://${text}`);
  if (!match) return null;
  const path = (match[3] ?? '').replace(/\/+$/, '');
  return `${(match[1] as string).toLowerCase()}://${match[2]}${path}`;
}

export function resolveServerUrl(saved: string, buildTimeDefault: string | undefined): string {
  return normalizeServerUrl(saved) ?? normalizeServerUrl(buildTimeDefault ?? '') ?? '';
}
