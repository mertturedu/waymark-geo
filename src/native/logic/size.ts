const MB = 1024 * 1024;
const GB = 1024 * MB;
const COMMA = new Set(['tr', 'de', 'ru', 'el']);

const trim = (value: number, comma: boolean): string => {
  const text = value.toFixed(1);
  const clean = text.endsWith('.0') ? text.slice(0, -2) : text;
  return comma ? clean.replace('.', ',') : clean;
};

export function formatBytes(bytes: number, lang = 'tr'): string {
  const comma = COMMA.has(lang);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= GB) return `${trim(bytes / GB, comma)} GB`;
  if (bytes < 10 * MB) return `${trim(Math.max(bytes / MB, 0.1), comma)} MB`;
  return `${Math.round(bytes / MB)} MB`;
}
