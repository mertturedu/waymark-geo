import type { ReportEntry } from '../../../src/core';
import type { DeviceTest } from '../device-test/types';

export type RunRequest = { ids: string[] | 'auto'; tab: 'app' | null; key: string; repeat: number };

export const MAX_REPEAT = 20;

const repeatOf = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_REPEAT) : 1;
};

const decode = (value: string): string => {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
};

export function parseRunUrl(url: string | null | undefined): RunRequest | null {
  if (!url) return null;
  const match = /^[a-z][a-z0-9+.-]*:\/\/run\/?(?:\?(.*))?$/i.exec(url.trim());
  if (!match) return null;
  const params = new Map<string, string>();
  for (const part of (match[1] ?? '').split('&')) {
    if (part === '') continue;
    const at = part.indexOf('=');
    params.set(decode(at < 0 ? part : part.slice(0, at)), decode(at < 0 ? '' : part.slice(at + 1)));
  }
  const raw = (params.get('ids') ?? '').trim();
  if (raw === '') return null;
  const ids = raw === 'auto' ? 'auto' : [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id !== ''))];
  if (ids !== 'auto' && ids.length === 0) return null;
  return { ids, tab: params.get('tab') === 'app' ? 'app' : null, key: url.trim(), repeat: repeatOf(params.get('repeat') ?? 1) };
}

const repeated = (tests: DeviceTest[], times: number): DeviceTest[] =>
  times <= 1 ? tests : Array.from({ length: times }, (_, round) => tests.map((test) => (round === 0 ? test : { ...test, id: `${test.id}#${round + 1}` }))).flat();

export function pickTests(request: RunRequest, registry: DeviceTest[], auto: DeviceTest[]): { tests: DeviceTest[]; missing: ReportEntry[] } {
  const picked = pickOnce(request, registry, auto);
  return { tests: repeated(picked.tests, request.repeat), missing: picked.missing };
}

function pickOnce(request: RunRequest, registry: DeviceTest[], auto: DeviceTest[]): { tests: DeviceTest[]; missing: ReportEntry[] } {
  if (request.ids === 'auto') return { tests: auto.filter((test) => !test.question), missing: [] };
  const tests: DeviceTest[] = [];
  const missing: ReportEntry[] = [];
  for (const id of request.ids) {
    const test = registry.find((candidate) => candidate.id === id);
    if (!test) missing.push({ id, title: id, kind: 'auto', outcome: 'fail', note: 'kayıt bulunamadı' });
    else if (test.question) missing.push({ id, title: test.title, kind: 'manual', outcome: 'skip', note: 'soru kaydı otomatik koşmaz' });
    else tests.push(test);
  }
  return { tests, missing };
}

export function parseRunJob(text: string): RunRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const job = value as { ids?: unknown; tab?: unknown; n?: unknown; repeat?: unknown };
  if (typeof job.n !== 'string' || job.n === '') return null;
  let ids: string[] | 'auto';
  if (job.ids === 'auto') ids = 'auto';
  else if (Array.isArray(job.ids) && job.ids.every((id) => typeof id === 'string')) {
    ids = [...new Set((job.ids as string[]).map((id) => id.trim()).filter((id) => id !== ''))];
    if (ids.length === 0) return null;
  } else return null;
  return { ids, tab: job.tab === 'app' ? 'app' : null, key: `job:${job.n}`, repeat: repeatOf(job.repeat ?? 1) };
}

export const jobEndpoint = (server: string): string => `${server.replace(/\/+$/, '')}/run`;

export const reportEndpoint = (server: string): string => `${server.replace(/\/+$/, '')}/report`;
