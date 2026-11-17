const SHORT_FAILURE_MS = 2000;

export function describeProbeFailure(url: string, error: unknown, elapsedMs: number, timeoutMs: number): string {
  const raw = error instanceof Error ? error.message : error === undefined ? '' : String(error);
  const aborted = error instanceof Error && error.name === 'AbortError';
  if (aborted || elapsedMs >= timeoutMs - 100) {
    return `zaman aşımı (${elapsedMs} ms): telefon ${url} adresine ulaşamıyor. Mac ve iPhone aynı Wi-Fi'da mı, ağda cihazlar birbirini engelliyor olabilir mi?`;
  }
  if (elapsedMs < SHORT_FAILURE_MS) {
    return `bağlantı hemen koptu (${elapsedMs} ms, "${raw}"): ${url}. Ayarlar > Gizlilik ve Güvenlik > Yerel Ağ içinde uygulamanın izni kapalı olabilir.`;
  }
  return `sunucuya ulaşılamadı (${elapsedMs} ms, "${raw}"): ${url}`;
}
