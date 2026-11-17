import type { LngLat } from '../geo/cells';
import type { Lang } from '../text/types';

export type Precision = 'address' | 'interpolated' | 'street' | 'neighbourhood' | 'district' | 'province' | 'poi';
export type Source = 'osm' | 'overture' | 'learned' | 'correction' | 'interpolated' | 'derived';

export type Components = {
  province?: string;
  district?: string;
  neighbourhood?: string;
  street?: string;
  houseNumber?: string;
  building?: string;
  door?: string;
  postcode?: string;
  poiName?: string;
};

export type PlaceDetails = { category?: string; brand?: string };

export type Place = {
  id: string;
  label: string;
  components: Components;
  coordinate: LngLat;
  precision: Precision;
  approximate: boolean;
  source: Source;
  confidence: number;
  region: string;
  details?: PlaceDetails;
  local?: Components;
};

export type ResolveResult =
  | { status: 'resolved'; best: Place; candidates: Place[]; missing?: string[]; suggestion?: Place }
  | { status: 'ambiguous'; candidates: Place[]; missing?: string[]; suggestion?: Place }
  | { status: 'not_found'; candidates: Place[]; missing?: string[] }
  | { status: 'region_missing'; regions: string[] };

export type Hints = { city?: string; district?: string };

export type SearchOptions = { near?: LngLat; hints?: Hints; limit?: number; language?: Lang };

export type StructuredQuery = {
  province?: string;
  district?: string;
  neighbourhood?: string;
  street?: string;
  houseNumber?: string;
  building?: string;
  door?: string;
  poiName?: string;
};

export type LayerKey = { region: string; district: string; neighbourhood: string; street: string; houseNumber: string };
export type LayerPoint = { coordinate: LngLat; trusted: boolean };
export type LayerScope = { region: string; district: string; neighbourhood: string; street: string };
export type LayerNeighbour = { int: number; coordinate: LngLat; trusted: boolean };
export type PointLayer = {
  name: 'learned' | 'correction';
  lookup(key: LayerKey): Promise<LayerPoint | null>;
  nearby?(scope: LayerScope): Promise<LayerNeighbour[]>;
};
