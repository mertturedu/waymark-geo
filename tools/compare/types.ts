export type Level = 'building' | 'street' | 'hood' | 'district' | 'province' | 'none';

export type Parts = {
  province?: string;
  district?: string;
  hood?: string;
  street?: string;
  number?: string;
  block?: string;
  floor?: string;
  door?: string;
  place?: string;
};

export type EngineResult = { found: boolean; point: [number, number] | null; level: Level; parts: Parts; ms: number };

export type Engine = { name: string; query(text: string): Promise<EngineResult> };

export const NONE: EngineResult = { found: false, point: null, level: 'none', parts: {}, ms: 0 };
