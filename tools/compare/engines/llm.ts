import { cached } from '../cache';
import { NONE, type Engine, type Parts } from '../types';

export const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    province: { type: 'string' }, district: { type: 'string' }, hood: { type: 'string' }, street: { type: 'string' }, number: { type: 'string' },
    block: { type: 'string' }, floor: { type: 'string' }, door: { type: 'string' }, place: { type: 'string' },
  },
  required: ['province', 'district', 'hood', 'street', 'number', 'block', 'floor', 'door', 'place'],
} as const;

export const PARSE_PROMPT = 'Türkiye adres metnini bileşenlerine ayır. Metinde olmayan bileşeni boş bırak. province=il, district=ilçe, hood=mahalle (Mah. eki olmadan değil, yazıldığı gibi), street=sokak/cadde/bulvar adı türüyle, number=kapı numarası (dış kapı), block=blok, floor=kat, door=daire/iç kapı, place=site, apartman, işletme ya da yer adı. Telefon ve notları yok say. Yalnızca JSON döndür.';

export function llm(model: string, base = 'http://127.0.0.1:11434'): Engine {
  return {
    name: `llm-${model.replace(/[^a-z0-9]+/gi, '_')}`,
    query: (text) =>
      cached(`llm-${model.replace(/[^a-z0-9]+/gi, '_')}`, text, async () => {
        const started = performance.now();
        const response = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            format: PARSE_SCHEMA,
            options: { temperature: 0, seed: 7, num_predict: 200 },
            messages: [{ role: 'system', content: PARSE_PROMPT }, { role: 'user', content: text }],
          }),
        });
        const ms = performance.now() - started;
        if (!response.ok) return { ...NONE, ms };
        const content = ((await response.json()) as { message: { content: string } }).message.content;
        let value: Record<string, string>;
        try {
          value = JSON.parse(content) as Record<string, string>;
        } catch {
          return { ...NONE, ms };
        }
        const parts: Parts = {};
        for (const [key, v] of Object.entries(value)) if (typeof v === 'string' && v.trim() !== '') (parts as Record<string, string>)[key] = v.trim();
        return { found: true, point: null, level: 'none', parts, ms };
      }),
  };
}
