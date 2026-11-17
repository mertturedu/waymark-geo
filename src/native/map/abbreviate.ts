export const LINE_CHARS = 12;
export const MAX_LINES = 2;

const SHORT: Record<string, string> = {
  Merkezi: 'Mrk.',
  Belediyesi: 'Bel.',
  Başkanlığı: 'Bşk.',
  Müdürlüğü: 'Müd.',
  Mahallesi: 'Mah.',
  Üniversitesi: 'Üni.',
  Hastanesi: 'Hast.',
  Ortaokulu: 'Ortaok.',
  İlkokulu: 'İlkok.',
  Lisesi: 'Lis.',
  Fakültesi: 'Fak.',
  Kampüsü: 'Kamp.',
  Caddesi: 'Cad.',
  Sokağı: 'Sk.',
  Bulvarı: 'Blv.',
  Ticaret: 'Tic.',
  Sanayi: 'San.',
  Sağlık: 'Sağ.',
  Eğitim: 'Eğt.',
  Araştırma: 'Araş.',
  Uygulama: 'Uyg.',
  Şirketi: 'Şti.',
  Limited: 'Ltd.',
  Anonim: 'A.',
  Toptancı: 'Top.',
  Halleri: 'Hal.',
  Dernekleri: 'Der.',
  Kooperatifi: 'Koop.',
};

export function lineCount(name: string, width = LINE_CHARS): number {
  let lines = 1;
  let used = 0;
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const length = [...word].length;
    if (used === 0) used = length;
    else if (used + 1 + length <= width) used += 1 + length;
    else {
      lines += 1;
      used = length;
    }
  }
  return lines;
}

export function abbreviateName(name: string, width = LINE_CHARS, maxLines = MAX_LINES): string {
  if (lineCount(name, width) <= maxLines) return name;
  const words = name.split(/\s+/).filter(Boolean);
  for (let at = words.length - 1; at > 0; at -= 1) {
    const short = SHORT[words[at] as string];
    if (!short) continue;
    words[at] = short;
    if (lineCount(words.join(' '), width) <= maxLines) return words.join(' ');
  }
  for (let at = 0; at < words.length - 1; at += 1) {
    const short = SHORT[words[at] as string];
    if (!short) continue;
    words[at] = short;
    if (lineCount(words.join(' '), width) <= maxLines) return words.join(' ');
  }
  return words.join(' ');
}
