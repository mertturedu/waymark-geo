import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeText, speechPhonemes } from '../src/core/voice';
import { openVoice, toWav } from '../src/node/voice';
import type { TryCommands } from './try';

const DEFAULT_MODEL = join(homedir(), 'yuksi-ses', 'cikti', 'ses', 'ses.onnx');

function flags(args: string[]): { words: string[]; model: string; out?: string; play: boolean; noise?: number; length?: number } {
  const words: string[] = [];
  let model = process.env.YUKSI_VOICE ?? DEFAULT_MODEL;
  let out: string | undefined;
  let play = false;
  let noise: number | undefined;
  let length: number | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '--model') model = args[++i] as string;
    else if (arg === '--out') out = args[++i] as string;
    else if (arg === '--noise') noise = Number(args[++i]);
    else if (arg === '--length') length = Number(args[++i]);
    else if (arg === '--play') play = true;
    else words.push(arg);
  }
  return { words, model, out, play, noise, length };
}

export function voiceCommands(): TryCommands {
  return {
    async g2p(args) {
      const text = flags(args).words.join(' ');
      console.log(normalizeText(text));
      console.log(speechPhonemes(text));
    },
    async say(args) {
      const { words, model, out, play, noise, length } = flags(args);
      const text = words.join(' ');
      if (!text) throw new Error('kullanım: say "metin" [--model dosya.onnx] [--out dosya.wav] [--play] [--noise 0.667] [--length 1.0]');
      const voice = await openVoice(model);
      const started = Date.now();
      const samples = await voice.say(text, { noiseScale: noise, lengthScale: length });
      const took = Date.now() - started;
      const seconds = samples.length / voice.sampleRate;
      const file = out ?? join(homedir(), 'yuksi-ses', 'cikti', 'ses', 'son.wav');
      writeFileSync(file, toWav(samples, voice.sampleRate));
      console.log(`${file}  ${seconds.toFixed(2)} sn ses, ${took} ms (gerçek zaman oranı ${(took / 1000 / seconds).toFixed(2)})`);
      if (play) spawnSync('afplay', [file], { stdio: 'inherit' });
    },
    async 'say-cues'(args) {
      const { model, out } = flags(args);
      const lines = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'voice-cues.txt'), 'utf8').split('\n').filter(Boolean);
      const voice = await openVoice(model);
      const dir = out ?? join(homedir(), 'yuksi-ses', 'cikti', 'ses', 'cues');
      spawnSync('mkdir', ['-p', dir]);
      for (const [i, line] of lines.entries()) {
        const samples = await voice.say(line);
        writeFileSync(join(dir, `${String(i + 1).padStart(2, '0')}.wav`), toWav(samples, voice.sampleRate));
      }
      console.log(`${lines.length} cümle: ${dir}`);
    },
  };
}
