export type RegionProbe = { location: [number, number] | null; action: string; installed: string[]; waiting: string[]; remove: (id: string) => Promise<void> };

let current: RegionProbe | null = null;

export const publishRegionProbe = (next: RegionProbe | null): void => {
  current = next;
};

export const regionProbe = (): RegionProbe | null => current;
