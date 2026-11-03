import { isRtl, messageLang, t, type MessageKey } from '../../core/i18n/messages';
import type { RegionStatus } from '../../core/packs/manager';
import type { PartKind } from '../../core/packs/state-file';
import type { ManifestRegion } from '../../core/region/manifest';

export type RowAction = 'download' | 'pause' | 'resume' | 'remove' | 'update' | 'retry' | 'cellular';

export type RegionRow = {
  id: string;
  name: string;
  sizeText: string;
  statusText: string;
  errorText: string | null;
  progressPercent: number | null;
  updatedText: string | null;
  actions: RowAction[];
  busy: boolean;
  rtl: boolean;
};

const DEFAULT_PARTS: PartKind[] = ['address', 'tiles', 'places', 'directory'];

export function formatMegabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (!Number.isFinite(mb) || mb <= 0) return '0';
  if (mb < 9.95) return String(Math.round(mb * 10) / 10);
  return String(Math.round(mb));
}

export function plannedBytes(region: ManifestRegion, status: RegionStatus, baseBytes: number): number {
  const parts = status.installedParts.length > 0 ? status.installedParts : DEFAULT_PARTS;
  const own = region.files.filter((file) => (parts as string[]).includes(file.kind)).reduce((sum, file) => sum + file.size, 0);
  const wantsMap = region.files.some((file) => file.kind === 'tiles' && (parts as string[]).includes('tiles'));
  return own + (wantsMap ? baseBytes : 0);
}

const ACTIONS: Record<RegionStatus['state'], RowAction[]> = {
  none: ['download'],
  queued: ['pause'],
  downloading: ['pause'],
  verifying: [],
  paused: ['resume', 'remove'],
  installed: ['remove'],
  'update-available': ['update', 'remove'],
  error: ['retry', 'remove'],
};

const BUSY = new Set<RegionStatus['state']>(['queued', 'downloading', 'verifying']);

function installedBytes(region: ManifestRegion, status: RegionStatus): number {
  return region.files.filter((file) => (status.installedParts as string[]).includes(file.kind)).reduce((sum, file) => sum + file.size, 0);
}

export function formatVersionDate(version: string | null | undefined, lang: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:\.|$)/.exec(version ?? '');
  if (!match) return null;
  const [, year, month, day] = match;
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return messageLang(lang) === 'en' ? `${year}-${month}-${day}` : `${day}.${month}.${year}`;
}

export function describeRegion(input: { region: ManifestRegion; status: RegionStatus; baseBytes: number; lang: string; consentPending?: boolean }): RegionRow {
  const { region, status, lang } = input;
  const code = messageLang(lang);
  const progress = status.progress;
  const percent = progress && progress.total > 0 ? Math.min(100, Math.max(0, Math.floor((100 * progress.done) / progress.total))) : null;
  const actions = [...ACTIONS[status.state]];
  if (status.state === 'queued' && status.waitingWifi) actions.push('cellular');
  const statusKey: MessageKey = input.consentPending ? 'status.waiting-consent' : status.waitingWifi ? 'status.waiting-wifi' : (`status.${status.state}` as MessageKey);
  const date = formatVersionDate(status.installedVersion, lang);
  return {
    id: region.id,
    name: region.names[code] ?? region.names.en ?? region.names.tr ?? region.id,
    sizeText: status.state === 'installed' ? t(lang, 'installed.size', { size: formatMegabytes(installedBytes(region, status)) }) : t(lang, 'size.mb', { size: formatMegabytes(plannedBytes(region, status, input.baseBytes)) }),
    statusText: t(lang, statusKey),
    errorText: status.error ? t(lang, `error.${status.error.code}` as MessageKey) : null,
    progressPercent: percent,
    updatedText: date ? t(lang, 'sheet.updated', { date }) : null,
    actions,
    busy: BUSY.has(status.state),
    rtl: isRtl(lang),
  };
}

export function orderRegions(regions: ManifestRegion[], statusOf: (id: string) => RegionStatus): ManifestRegion[] {
  const rank = (region: ManifestRegion): number => (statusOf(region.id).state === 'none' ? 1 : 0);
  return [...regions].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
