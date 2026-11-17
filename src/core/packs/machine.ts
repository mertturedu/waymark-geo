export const STATES = ['none', 'queued', 'downloading', 'paused', 'verifying', 'installed', 'update-available', 'error'] as const;
export type RegionState = (typeof STATES)[number];

export const EVENTS = ['request', 'start', 'pause', 'resume', 'verify', 'complete', 'fail', 'remove', 'update-found', 'update-gone', 'restore'] as const;
export type RegionEvent = (typeof EVENTS)[number];

export const TRANSITIONS: Record<RegionState, Partial<Record<RegionEvent, RegionState>>> = {
  none: { request: 'queued', remove: 'none' },
  queued: { start: 'downloading', pause: 'paused', fail: 'error', remove: 'none', restore: 'paused' },
  downloading: { pause: 'paused', verify: 'verifying', fail: 'error', remove: 'none', restore: 'paused' },
  paused: { resume: 'queued', remove: 'none' },
  verifying: { complete: 'installed', fail: 'error', remove: 'none', restore: 'paused' },
  installed: { request: 'queued', 'update-found': 'update-available', remove: 'none' },
  'update-available': { request: 'queued', 'update-gone': 'installed', remove: 'none' },
  error: { request: 'queued', remove: 'none' },
};

export function step(state: RegionState, event: RegionEvent): { ok: boolean; state: RegionState } {
  const next = TRANSITIONS[state][event];
  return next ? { ok: true, state: next } : { ok: false, state };
}
