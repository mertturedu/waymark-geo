import type { ParsedAddress } from '../src/core/text/types';

const row = (label: string, value: string): string => `${`${label}:`.padEnd(8)} ${value}`;

export function formatParsed(parsed: ParsedAddress): string[] {
  const lines = [row('Giriş', parsed.input)];
  const found: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') found.push(row(label, value));
  };
  add('Dil', parsed.language);
  add('İl', parsed.province ? `${parsed.province.name} (${parsed.province.id})` : null);
  add('İlçe', parsed.district ? `${parsed.district.name}${parsed.district.ambiguous ? ' (birden çok ilde var)' : ''}` : null);
  add('Mahalle', parsed.neighbourhood);
  add('Sokak', parsed.street ? `${parsed.street.key}${parsed.street.kind ? ` (${parsed.street.kind})` : ''}` : null);
  add('Numara', parsed.houseNumber);
  add('Bina', parsed.building);
  add('Blok', parsed.block);
  add('Kat', parsed.floor);
  add('Daire', parsed.door);
  add('Yer', parsed.poiName);
  add('Posta', parsed.postcode);
  add('Kalan', parsed.leftover.join(' '));
  return found.length === 0 ? [...lines, 'Hiçbir parça bulunamadı.'] : [...lines, ...found];
}
