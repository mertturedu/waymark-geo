import { hoodSuggestions } from '../../pipeline/build/learned-hoods';
import type { DeliveryRecord } from '../../pipeline/real/records';
import type { Search } from '../../src/core/address/search';
import type { Place } from '../../src/core/address/types';

const place = (neighbourhood: string | undefined, local?: string): Place => ({ id: 'x', label: '', components: neighbourhood ? { neighbourhood } : {}, ...(local ? { local: { neighbourhood: local } } : {}), coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34' });
const search = (found: Place | null): Search => ({ reverse: async () => found }) as unknown as Search;
const record = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({ v: 1, src: 's', week: 1, region: '34', district: 'Kadıköy', neighbourhood: 'Moda Mah.', houseNumber: '4', coordSource: 'gps', gps: { lng: 29, lat: 41, accuracyM: 8 }, ...over }) as DeliveryRecord;

describe('hoodSuggestions', () => {
  it('lists the neighbourhoods couriers write for places that lie in another one, once at least three agree', async () => {
    const records = [record(), record(), record(), record({ gps: { lng: 29, lat: 41, accuracyM: 90 } })];
    expect(await hoodSuggestions(records, search(place('Fenerbahçe')))).toEqual([{ region: '34', district: 'Kadıköy', written: 'Moda Mah.', found: 'Fenerbahçe', count: 3 }]);
    expect(await hoodSuggestions(records.slice(0, 2), search(place('Fenerbahçe')))).toEqual([]);
  });

  it('says nothing when the point is in the written neighbourhood, unknown or the record has no point or hood', async () => {
    const same = [record(), record(), record()];
    expect(await hoodSuggestions(same, search(place('Moda')))).toEqual([]);
    expect(await hoodSuggestions(same, search(place(undefined)))).toEqual([]);
    expect(await hoodSuggestions(same, search(null))).toEqual([]);
    expect(await hoodSuggestions([record({ neighbourhood: undefined }), record({ gps: undefined })], search(place('Fenerbahçe')), 1)).toEqual([]);
  });

  it('uses the stop, then the pin, and compares the Turkish name', async () => {
    const seen: [number, number][] = [];
    const spy = { reverse: async (p: [number, number]) => (seen.push(p), place('Fenerbahçe', 'Moda')) } as unknown as Search;
    const records = [record({ stop: { lng: 1, lat: 2 } }), record({ pin: { lng: 3, lat: 4 } })];
    expect(await hoodSuggestions(records, spy, 1)).toEqual([]);
    expect(seen).toEqual([[1, 2], [3, 4]]);
  });
});
