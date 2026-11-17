export type Cursor = {
  u(): number;
  z(): number;
  pos(): number;
  seek(to: number): void;
  end(): number;
};

export function packError(message: string): Error {
  return Object.assign(new Error(`route pack: ${message}`), { code: 'route_pack_corrupt' });
}

export function cursorOf(buf: Uint8Array, start: number, end: number): Cursor {
  if (start < 0 || end > buf.length || start > end) throw packError('section out of range');
  let at = start;
  const u = (): number => {
    let value = 0;
    let scale = 1;
    for (let i = 0; i < 5; i++) {
      if (at >= end) throw packError('truncated');
      const byte = buf[at++] as number;
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) {
        if (value > 0xffffffff) throw packError('number too large');
        return value;
      }
      scale *= 128;
    }
    throw packError('number too long');
  };
  return {
    u,
    z() {
      const v = u();
      return v % 2 === 0 ? v / 2 : -(v + 1) / 2;
    },
    pos: () => at,
    seek(to) {
      if (to < start || to > end) throw packError('seek out of range');
      at = to;
    },
    end: () => end,
  };
}
