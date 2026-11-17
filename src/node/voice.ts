import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import { speechIds, type PhonemeIdMap } from '../core/voice';

export type VoiceOptions = { noiseScale?: number; lengthScale?: number; noiseW?: number };

export type Voice = {
  sampleRate: number;
  say: (text: string, options?: VoiceOptions) => Promise<Float32Array>;
};

type VoiceConfig = { audio: { sample_rate: number }; phoneme_id_map: PhonemeIdMap; inference?: { noise_scale?: number; length_scale?: number; noise_w?: number } };

export async function openVoice(modelPath: string, configPath = `${modelPath}.json`): Promise<Voice> {
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as VoiceConfig;
  const session = await ort.InferenceSession.create(modelPath);
  const base = config.inference ?? {};
  return {
    sampleRate: config.audio.sample_rate,
    async say(text, options = {}) {
      const ids = speechIds(text, config.phoneme_id_map);
      const input = new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
      const lengths = new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]);
      const scales = new ort.Tensor('float32', Float32Array.from([options.noiseScale ?? base.noise_scale ?? 0.667, options.lengthScale ?? base.length_scale ?? 1, options.noiseW ?? base.noise_w ?? 0.8]), [3]);
      const result = await session.run({ input, input_lengths: lengths, scales });
      return (result.output as ort.Tensor).data as Float32Array;
    },
  };
}

export function toWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => value.split('').forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 1 ? 1 / peak : 1;
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * gain)) * 32767, true));
  return bytes;
}
