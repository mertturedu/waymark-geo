import type { BuildingLayout, StreetHint } from '../learned/types';
import type { LngLat } from '../geo/cells';
import type { Lang } from '../text/types';
import type { UnitInfo } from './unit';

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

export type BuildingDetail = {
  id: number;
  levels: number;
  levelsSource: 'num_floors' | 'osm' | 'height' | 'region';
  areaM2: number;
  entrances: { kind: string | null; ref: string | null; flats: string | null; point: LngLat }[];
  site: string | null;
};

export type UnitHint = { blocks: string[]; floors: number | null; flats: number | null; floorsSource: BuildingDetail['levelsSource'] | null };

export type AroundDoor = { offset: -2 | -1 | 1 | 2; coordinate: LngLat; number: string | null };

export type PlaceGeometry =
  | { kind: 'street'; lines: LngLat[][]; local: number[]; numbers: [number, number] | null; parts: number; points: number }
  | { kind: 'area'; level: 'neighbourhood' | 'district'; polygons: LngLat[][][]; points: number };

export type Place = {
  id: string;
  sid?: string;
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
  notes?: string[];
  radiusM?: number;
  entrance?: LngLat;
  unit?: UnitInfo;
  relation?: { kind: 'opposite' | 'beside' | 'behind' | 'corner'; landmark: string };
  completion?: string;
  unitHint?: UnitHint;
  side?: 'left' | 'right';
  numberRange?: [number, number];
  building?: BuildingDetail;
  around?: AroundDoor[];
  bbox?: [number, number, number, number];
  geometry?: PlaceGeometry;
};

export type ResolveResult =
  | { status: 'resolved'; best: Place; candidates: Place[]; missing?: string[]; suggestion?: Place }
  | { status: 'ambiguous'; candidates: Place[]; missing?: string[]; suggestion?: Place }
  | { status: 'not_found'; candidates: Place[]; missing?: string[] }
  | { status: 'region_missing'; regions: string[] };

export type Hints = { city?: string; district?: string };

export type SearchOptions = { near?: LngLat; hints?: Hints; limit?: number; language?: Lang; geometry?: boolean };

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
  layout?(region: string, key: string): Promise<BuildingLayout | null>;
  hints?(region: string, district: string): Promise<StreetHint[]>;
  entrances?(region: string, key: string): Promise<LngLat[]>;
};
