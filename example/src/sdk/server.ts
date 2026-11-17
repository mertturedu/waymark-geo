import { useCallback, useEffect, useState } from 'react';
import { candidateUrls, findServer } from '../device-test/find-server';
import { FALLBACK_SERVER, normalizeServerUrl } from '../device-test/server-url';
import { loadServerUrl, saveServerUrl } from '../device-test/storage';
import { probeServer } from '../device-test/tests/env';

export const DEFAULT_SERVERS = [process.env.EXPO_PUBLIC_PACK_SERVER_URLS, process.env.EXPO_PUBLIC_PACK_SERVER_URL, FALLBACK_SERVER].filter(Boolean).join(',');
export const PUBLIC_KEY = process.env.EXPO_PUBLIC_GEO_PUBLIC_KEY ?? '';

export const manifestUrlOf = (server: string): string => `${server}/manifest-v1.json`;

export function useServer(): { url: string; ready: boolean; note: string; set: (typed: string) => void; find: () => Promise<void> } {
  const [url, setUrl] = useState('');
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState('');

  const find = useCallback(async () => {
    const saved = await loadServerUrl().catch(() => '');
    const urls = candidateUrls(saved, DEFAULT_SERVERS);
    const found = await findServer(urls, (candidate) => probeServer(candidate, 3000));
    const chosen = found.url ?? urls[0] ?? '';
    setUrl(chosen);
    setNote(found.url ? `Sunucu bulundu: ${found.url}` : chosen ? `Sunucuya ulaşılamadı, kayıtlı adres kullanılıyor: ${chosen}` : 'Sunucu adresi yok');
    if (found.url) saveServerUrl(found.url);
    setReady(true);
  }, []);

  useEffect(() => {
    void find();
  }, [find]);

  const set = useCallback((typed: string) => {
    const normalized = normalizeServerUrl(typed);
    if (normalized) {
      setUrl(normalized);
      saveServerUrl(normalized);
    }
  }, []);

  return { url, ready, note, set, find };
}
