import type { ReportEntry } from '../../../src/core';

export const encodeEntries = (buildId: string, entries: Record<string, ReportEntry>): string => JSON.stringify({ buildId, entries });

export function decodeEntries(text: string, buildId: string): Record<string, ReportEntry> {
  try {
    const parsed = JSON.parse(text) as { buildId?: unknown; entries?: unknown } | null;
    if (!parsed || parsed.buildId !== buildId || typeof parsed.entries !== 'object' || parsed.entries === null || Array.isArray(parsed.entries)) return {};
    return parsed.entries as Record<string, ReportEntry>;
  } catch {
    return {};
  }
}
