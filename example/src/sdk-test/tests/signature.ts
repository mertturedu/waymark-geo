import { SDK_VERSION } from '../../../../src/core';
import { verifyManifest } from '../../../../src/core/packs/verify';
import { PUBLIC_KEY } from '../../sdk/server';
import type { DeviceTest } from '../../device-test/types';
import { manifestUrlOf } from '../sandbox';

export const sdkSignature: DeviceTest = {
  id: 'sdk.signature',
  title: 'Manifest imzası: doğrulama süresi, bozuk metin ve yanlış anahtar',
  kind: 'auto',
  async run(ctx) {
    if (!PUBLIC_KEY) return { outcome: 'fail', note: 'derlemede EXPO_PUBLIC_GEO_PUBLIC_KEY yok' };
    const url = manifestUrlOf(ctx);
    const [text, signature] = await Promise.all([fetch(url).then((r) => r.text()), fetch(`${url}.sig`).then((r) => r.text())]);
    const started = performance.now();
    const good = verifyManifest({ text, signature, publicKeys: [PUBLIC_KEY], sdkVersion: SDK_VERSION });
    const ms = performance.now() - started;
    const tampered = verifyManifest({ text: `${text} `, signature, publicKeys: [PUBLIC_KEY], sdkVersion: SDK_VERSION });
    const wrongKey = verifyManifest({ text, signature, publicKeys: [`${PUBLIC_KEY.slice(0, -4)}AAAA`], sdkVersion: SDK_VERSION });
    const problems: string[] = [];
    if (!good.ok) problems.push(`doğru manifest reddedildi: ${good.code}`);
    if (tampered.ok || tampered.code !== 'signature') problems.push('bozulmuş metin kabul edildi');
    if (wrongKey.ok) problems.push('yanlış anahtar kabul edildi');
    return problems.length > 0 ? { outcome: 'fail', note: problems.join('; ') } : { outcome: 'pass', value: ms.toFixed(0), unit: 'ms (Hermes üzerinde doğrulama)', note: `manifest ${Math.round(text.length / 1024)} KB` };
  },
};
