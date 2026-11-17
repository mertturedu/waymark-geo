export type Hierarchy = {
  n: number;
  upFirst: Uint32Array;
  upTo: Uint32Array;
  upW: Uint32Array;
  upLen: Uint32Array;
  upVia: Uint32Array;
  downFirst: Uint32Array;
  downFrom: Uint32Array;
  downW: Uint32Array;
  downLen: Uint32Array;
  downVia: Uint32Array;
};

export const ORIGINAL = 0x80000000;
export const VIA_MASK = 0x7fffffff;
