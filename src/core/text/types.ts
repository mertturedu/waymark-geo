export type Lang = 'tr' | 'en' | 'de' | 'ar' | 'ru' | 'el';

export type WordKind = 'sokak' | 'cadde' | 'bulvar' | 'yol' | 'cikmaz' | 'meydan' | 'mahalle' | 'numara' | 'daire' | 'kat' | 'blok' | 'site' | 'bina';

export type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'other';

export type AdminNames = { tr: string } & Partial<Record<Exclude<Lang, 'tr'>, string>>;

export type AdminProvince = { plate: string; names: AdminNames; alt: string[] };

export type AdminDistrict = { province: string; names: AdminNames; alt: string[] };

export type AdminData = { provinces: AdminProvince[]; districts: AdminDistrict[] };

export type AdminMatch = { id: string; name: string; plate?: string; ambiguous: boolean };

export type ParsedStreet = { text: string; key: string; compact: string; kind: WordKind | null; number: number | null };

export type ParsedAddress = {
  input: string;
  language: Lang | null;
  province: AdminMatch | null;
  district: AdminMatch | null;
  neighbourhood: string | null;
  street: ParsedStreet | null;
  secondStreet: ParsedStreet | null;
  houseNumber: string | null;
  building: string | null;
  block: string | null;
  entrance: string | null;
  floor: string | null;
  door: string | null;
  poiName: string | null;
  postcode: string | null;
  leftover: string[];
  dropped: string[];
  alternatives: ParsedAddress[];
};
