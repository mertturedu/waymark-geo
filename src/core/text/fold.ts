import { toAsciiDigits } from './digits';
import { transliterate } from './translit';

export const MAX_INPUT = 500;

const GROUPS: [string, string][] = [
  ['a', 'àáâãäåāăąǎÀÁÂÃÄÅĀĂĄǍ'],
  ['c', 'çćĉċčÇĆĈĊČ'],
  ['d', 'ďđðĎĐÐ'],
  ['e', 'èéêëēĕėęěÈÉÊËĒĔĖĘĚ'],
  ['g', 'ğĝġģĞĜĠĢ'],
  ['h', 'ĥħĤĦ'],
  ['i', 'ìíîïĩīĭįıİÌÍÎÏĨĪĬĮ'],
  ['j', 'ĵĴ'],
  ['k', 'ķĶ'],
  ['l', 'ĺļľŀłĹĻĽĿŁ'],
  ['n', 'ñńņňÑŃŅŇ'],
  ['o', 'òóôõöøōŏőǒÒÓÔÕÖØŌŎŐǑ'],
  ['r', 'ŕŗřŔŖŘ'],
  ['s', 'śŝşšșŚŜŞŠȘ'],
  ['t', 'ţťțŢŤȚ'],
  ['u', 'ùúûüũūŭůűųǔÙÚÛÜŨŪŬŮŰŲǓ'],
  ['w', 'ŵŴ'],
  ['y', 'ýÿŷÝŸŶ'],
  ['z', 'źżžŹŻŽ'],
  ['ss', 'ßẞ'],
  ['ae', 'æÆ'],
  ['oe', 'œŒ'],
  ['th', 'þÞ'],
  ['α', 'άΆ'],
  ['ε', 'έΈ'],
  ['η', 'ήΉ'],
  ['ι', 'ίΊ'],
  ['ϊ', 'Ϊΐ'],
  ['ο', 'όΌ'],
  ['υ', 'ύΎΰϋΫ'],
  ['ω', 'ώΏ'],
  ['σ', 'ς'],
  ['ا', 'أإآٱ'],
  ['ي', 'ىی'],
  ['ك', 'ک'],
];

const TABLE = new Map<string, string>();
for (const [to, chars] of GROUPS) for (const ch of chars) TABLE.set(ch, to);

const isSpaceCode = (code: number): boolean =>
  code <= 32 || (code >= 127 && code <= 160) || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000;

const isDropCode = (code: number): boolean =>
  code === 0xad ||
  code === 0x61c ||
  code === 0x180e ||
  (code >= 0x300 && code <= 0x36f) ||
  (code >= 0x610 && code <= 0x61a) ||
  (code >= 0x64b && code <= 0x65f) ||
  code === 0x640 ||
  code === 0x670 ||
  (code >= 0x200b && code <= 0x200f) ||
  (code >= 0x202a && code <= 0x202e) ||
  (code >= 0x2060 && code <= 0x2064) ||
  (code >= 0x2066 && code <= 0x2069) ||
  code === 0xfeff;

function foldPiece(ch: string, code: number): string {
  if (code < 128) return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : ch;
  const mapped = TABLE.get(ch);
  if (mapped !== undefined) return mapped;
  if (code >= 0x410 && code <= 0x42f) return String.fromCharCode(code + 32);
  if (code >= 0x400 && code <= 0x40f) return String.fromCharCode(code + 80);
  if (code >= 0x391 && code <= 0x3a9) return String.fromCharCode(code + 32);
  return ch;
}

export function truncateInput(text: string): string {
  if (text.length <= MAX_INPUT) return text;
  const last = text.charCodeAt(MAX_INPUT - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? MAX_INPUT - 1 : MAX_INPUT);
}

const COMPOSED: [string, string][] = [
  ['\u0438\u0306', '\u0439'], ['\u0418\u0306', '\u0419'], ['\u0435\u0308', '\u0451'], ['\u0415\u0308', '\u0401'], ['\u03b9\u0308', '\u03ca'], ['\u0399\u0308', '\u03aa'],
];

export function foldText(input: string): string {
  let text = input;
  for (const [pair, whole] of COMPOSED) if (text.includes(pair)) text = text.split(pair).join(whole);
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (isDropCode(code)) continue;
    if (isSpaceCode(code)) {
      if (out !== '' && !out.endsWith(' ')) out += ' ';
      continue;
    }
    out += foldPiece(ch, code);
  }
  return out.endsWith(' ') ? out.slice(0, -1) : out;
}

const isKeyCode = (code: number): boolean =>
  (code >= 97 && code <= 122) ||
  (code >= 48 && code <= 57) ||
  (code >= 0x621 && code <= 0x64a) ||
  (code >= 0x660 && code <= 0x669) ||
  (code >= 0x671 && code <= 0x6d3) ||
  (code >= 0x6f0 && code <= 0x6f9);

export function nameKey(text: string): string {
  let out = '';
  for (const ch of transliterate(toAsciiDigits(foldText(text)))) {
    if (isKeyCode(ch.codePointAt(0) as number)) out += ch;
    else if (out !== '' && !out.endsWith(' ')) out += ' ';
  }
  return out.endsWith(' ') ? out.slice(0, -1) : out;
}

export const compactKey = (text: string): string => nameKey(text).split(' ').join('');
