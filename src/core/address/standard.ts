import type { Lang } from '../text/types';
import type { Components, Place } from './types';
import { formatUnit } from './unit';

export type UavtParts = { province: string | null; district: string | null; neighbourhood: string | null; street: string | null; number: string | null; unit: string | null };

export type StandardAddress = { uavt: UavtParts; lines: string[]; text: string };

const NUMBER: Record<Lang, string> = { tr: 'No:', en: '', de: '', ar: '', ru: '', el: '' };
const HOOD: Record<Lang, string> = { tr: ' Mah.', en: '', de: '', ar: '', ru: '', el: '' };

const clean = (parts: (string | null | undefined)[]): string[] => parts.filter((p): p is string => typeof p === 'string' && p !== '');

function streetLine(c: Components, lang: Lang): string | null {
  const number = c.houseNumber ? `${NUMBER[lang]}${c.houseNumber}` : null;
  if (!c.street) return number;
  if (lang === 'en') return clean([c.houseNumber, c.street]).join(' ');
  if (lang === 'ru') return clean([c.street, c.houseNumber]).join(', ');
  return clean([c.street, number]).join(' ');
}

export function standardAddress(place: Place, lang: Lang = 'tr'): StandardAddress {
  const c = place.components;
  const unit = place.unit ? formatUnit(place.unit, lang) : c.door ? (lang === 'tr' ? `Daire ${c.door}` : `${c.door}`) : '';
  const hood = c.neighbourhood ? `${c.neighbourhood}${HOOD[lang]}${c.postcode ? ` ${c.postcode}` : ''}` : (c.postcode ?? null);
  const area = lang === 'tr' ? (c.district && c.province ? `${c.district}/${c.province}` : (c.district ?? c.province ?? null)) : clean([c.district, c.province]).join(lang === 'ar' ? '، ' : ', ');
  const lines = clean([c.poiName, streetLine(c, lang), c.building, unit === '' ? null : unit, hood, area]);
  return {
    uavt: { province: c.province ?? null, district: c.district ?? null, neighbourhood: c.neighbourhood ?? null, street: c.street ?? null, number: c.houseNumber ?? null, unit: unit === '' ? null : unit },
    lines,
    text: lines.join(lang === 'ar' ? '، ' : ', '),
  };
}
