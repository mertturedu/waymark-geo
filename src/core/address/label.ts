import type { Lang } from '../text/types';
import type { Components } from './types';

const join = (parts: (string | undefined)[], separator: string): string => parts.filter((p): p is string => !!p && p !== '').join(separator);

const DOOR: Record<string, string> = { en: 'Apt', de: 'Whg.', ru: 'кв.', el: 'Διαμ.', ar: 'شقة' };
const NUMBER: Record<string, string> = { en: 'No.', de: 'Nr.', ru: '№', el: 'Αρ.', ar: 'رقم' };

export function formatLabel(c: Components, lang: Lang | string): string {
  const detail = join([c.building, c.door ? `D:${c.door}` : undefined], ' ');
  if (lang === 'en' || lang === 'de' || lang === 'ru' || lang === 'el' || lang === 'ar') {
    const number = c.houseNumber;
    const street = !c.street
      ? join([number ? `${NUMBER[lang]} ${number}` : undefined], ' ')
      : lang === 'en' ? join([number, c.street], ' ') : lang === 'ru' ? join([c.street, number], ', ') : join([c.street, number], ' ');
    const comma = lang === 'ar' ? '، ' : ', ';
    const line = join([street, c.building, c.door ? `${DOOR[lang]} ${c.door}` : undefined], ' ');
    return (join([c.poiName, line, c.neighbourhood, c.district, c.province], comma) + (c.postcode ? ` ${c.postcode}` : '')).trim();
  }
  const street = c.street ? join([c.street, c.houseNumber ? `No:${c.houseNumber}` : undefined, detail], ' ') : undefined;
  const loose = c.street ? undefined : join([c.houseNumber ? `No:${c.houseNumber}` : undefined, detail], ' ');
  const hood = c.neighbourhood ? join([`${c.neighbourhood} Mah.`, loose], ' ') : loose || undefined;
  const area = c.district && c.province ? `${c.district}/${c.province}` : (c.district ?? c.province);
  return (join([c.poiName, street, hood, area], ', ') + (c.postcode ? ` ${c.postcode}` : '')).trim();
}
