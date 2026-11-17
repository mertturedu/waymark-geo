import { toAsciiDigits } from './digits';

const MOBILE = /(?:\+\s?90[\s-]?|\b0[\s-]?|\b)\(?5\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const LANDLINE = /(?:\+\s?90[\s-]?|\b0[\s-]?)\(?[2-4]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;

export type Stripped = { text: string; dropped: string[] };

export function stripPhones(raw: string): Stripped {
  const dropped: string[] = [];
  let text = toAsciiDigits(raw);
  for (const pattern of [MOBILE, LANDLINE]) {
    text = text.replace(pattern, (hit) => {
      dropped.push(hit.trim());
      return ' ';
    });
  }
  return { text: dropped.length === 0 ? raw : text, dropped };
}

const PHRASES: RegExp[][] = [
  [/^zile$/, /^basma(?:yin|yiniz)$/],
  [/^ara(?:yin|yiniz)$/, /^lutfen$/],
  [/^lutfen$/, /^ara(?:yin|yiniz)$/],
  [/^aramadan$/, /^gelmeyin$/],
  [/^kapida$/, /^odeme$/],
  [/^kapiciya$/, /^birakin$/],
  [/^teslimat$/, /^saat$/, /^\d+\w*$/, /^sonra$/],
  [/^teslimat$/, /^saat$/, /^\d+\w*$/],
];

export type Noted<T extends { t: string }> = { tokens: T[]; dropped: string[] };

export function stripNotes<T extends { t: string; seg: number }>(tokens: T[]): Noted<T> {
  const drop = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (drop.has(i)) continue;
    for (const phrase of [...PHRASES].sort((a, b) => b.length - a.length)) {
      const fits = phrase.every((re, k) => tokens[i + k] !== undefined && tokens[i + k]?.seg === tokens[i]?.seg && re.test(tokens[i + k]?.t ?? ''));
      if (!fits) continue;
      for (let k = 0; k < phrase.length; k++) drop.add(i + k);
      break;
    }
  }
  const last = tokens.length - 1;
  if (last > 0 && tokens[last]?.t === 'kargo' && tokens[last]?.seg === tokens[last - 1]?.seg && !drop.has(last - 1)) drop.add(last);
  const dropped: string[] = [];
  let run: string[] = [];
  tokens.forEach((token, i) => {
    if (drop.has(i)) run.push(token.t);
    else if (run.length > 0) {
      dropped.push(run.join(' '));
      run = [];
    }
  });
  if (run.length > 0) dropped.push(run.join(' '));
  return { tokens: tokens.filter((_, i) => !drop.has(i)), dropped };
}
