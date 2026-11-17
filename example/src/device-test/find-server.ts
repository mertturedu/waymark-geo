import { normalizeServerUrl } from './server-url';

export type ProbeResult = { ok: true; ms: number } | { ok: false; note: string };
export type Probe = (url: string) => Promise<ProbeResult>;
export type Attempt = { url: string; ok: boolean; note: string };

export function candidateUrls(typed: string, buildTimeList: string | undefined): string[] {
  const all = [typed, ...(buildTimeList ?? '').split(',')];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of all) {
    const url = normalizeServerUrl(entry);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export async function findServer(urls: string[], probe: Probe): Promise<{ url: string | null; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  for (const url of urls) {
    try {
      const result = await probe(url);
      if (result.ok) {
        attempts.push({ url, ok: true, note: `${result.ms} ms` });
        return { url, attempts };
      }
      attempts.push({ url, ok: false, note: result.note });
    } catch (error) {
      attempts.push({ url, ok: false, note: error instanceof Error ? error.message : String(error) });
    }
  }
  return { url: null, attempts };
}
