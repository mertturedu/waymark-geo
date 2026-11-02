import { createSearch, type Search } from '../../src/core/address/search';
import type { Components, Place, Precision, ResolveResult } from '../../src/core/address/types';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

type AppPrecision = 'address' | 'street' | 'locality' | 'district' | 'city' | 'pin';
type AddressDetailsType = { city?: string; district?: string; neighborhood?: string; street?: string; buildingNo?: string; doorNo?: string };
type AppLocation = { latitude: number; longitude: number; address: string; addressDetails: AddressDetailsType; name?: string };
type AppCandidate = { id: string; precision: AppPrecision; title: string; subtitle: string; latitude: number; longitude: number; details: AddressDetailsType };
type AppHints = { city?: string; district?: string };
type AppResolve = { kind: 'resolved'; location: LocationFor; precision: AppPrecision; approximate?: boolean } | { kind: 'ambiguous'; candidates: AppCandidate[] } | { kind: 'notFound' } | { kind: 'error' };
type LocationFor = AppLocation;
type AppRefine = { kind: 'moved'; latitude: number; longitude: number; address: string; precision: AppPrecision; details: AddressDetailsType } | { kind: 'kept' } | { kind: 'error' };

const PRECISION: Record<Precision, AppPrecision> = { address: 'address', interpolated: 'address', street: 'street', neighbourhood: 'locality', district: 'district', province: 'city', poi: 'address' };

const toDetails = (c: Components): AddressDetailsType => ({ city: c.province, district: c.district, neighborhood: c.neighbourhood, street: c.street, buildingNo: c.houseNumber, doorNo: c.door });
const toLocation = (p: Place): AppLocation => ({ latitude: p.coordinate[1], longitude: p.coordinate[0], address: p.label, addressDetails: toDetails(p.components), ...(p.components.poiName ? { name: p.components.poiName } : {}) });
const toCandidate = (p: Place): AppCandidate => ({ id: p.id, precision: PRECISION[p.precision], title: p.components.poiName ?? p.components.street ?? p.components.neighbourhood ?? p.components.district ?? p.components.province ?? '', subtitle: p.label, latitude: p.coordinate[1], longitude: p.coordinate[0], details: toDetails(p.components) });

function dropOtherDistricts(places: Place[], hints?: AppHints): Place[] {
  if (!hints?.district) return places;
  return places.filter((p) => p.components.district === hints.district);
}

function toAppResolve(result: ResolveResult, hints?: AppHints): AppResolve {
  if (result.status === 'region_missing') return { kind: 'error' };
  const candidates = dropOtherDistricts(result.candidates, hints);
  const best = result.status === 'resolved' && candidates.includes(result.best) ? result.best : null;
  if (best) return { kind: 'resolved', location: toLocation(best), precision: PRECISION[best.precision], ...(best.approximate ? { approximate: true } : {}) };
  if (candidates.length === 0) return { kind: 'notFound' };
  return candidates.length === 1 && result.status !== 'not_found' ? { kind: 'resolved', location: toLocation(candidates[0] as Place), precision: PRECISION[(candidates[0] as Place).precision], ...((candidates[0] as Place).approximate ? { approximate: true } : {}) } : { kind: 'ambiguous', candidates: candidates.map(toCandidate) };
}

const same = (a = '', b = ''): boolean => a.toLocaleLowerCase('tr') === b.toLocaleLowerCase('tr');
const compose = (d: AddressDetailsType): string => [d.street, d.buildingNo ? `No ${d.buildingNo}` : '', d.neighborhood ? `${d.neighborhood} Mahallesi` : '', d.district, d.city].filter(Boolean).join(' ');

async function refine(search: Search, details: AddressDetailsType): Promise<AppRefine> {
  const result = await search.resolve(compose(details), { hints: { city: details.city, district: details.district } });
  if (result.status === 'region_missing') return { kind: 'error' };
  if (result.status !== 'resolved') return { kind: 'kept' };
  const found = toDetails(result.best.components);
  const coarse = !['address', 'interpolated', 'street'].includes(result.best.precision);
  if (details.street && coarse) return { kind: 'kept' };
  if (!same(details.district, found.district) || !same(details.city, found.city)) return { kind: 'kept' };
  const merged: AddressDetailsType = { city: details.city || found.city, district: details.district || found.district, neighborhood: details.neighborhood || found.neighborhood, street: details.street || found.street, buildingNo: details.buildingNo || found.buildingNo, doorNo: details.doorNo };
  return { kind: 'moved', latitude: result.best.coordinate[1], longitude: result.best.coordinate[0], address: result.best.label, precision: PRECISION[result.best.precision], details: merged };
}

let closeStore: () => Promise<void> = async () => undefined;
let search: Search;

beforeAll(async () => {
  const { store, close } = await memoryStore({ '34': await builtPack() });
  closeStore = close;
  search = createSearch({ store, borders: turkeyBorders() });
});

afterAll(async () => closeStore());

describe('what the app reads from a result', () => {
  it('fills every field of the address details from the components', async () => {
    const result = toAppResolve(await search.resolve('İstanbul Kadıköy Moda Mah. Bahariye Caddesi No:14'));
    expect(result).toMatchObject({ kind: 'resolved', precision: 'address', location: { addressDetails: { city: 'İstanbul', district: 'Kadıköy', neighborhood: 'Moda', street: 'Bahariye Caddesi', buildingNo: '14' } } });
    expect(result.kind === 'resolved' && result.approximate).toBeFalsy();
    expect(toDetails({ province: 'A', district: 'B', neighbourhood: 'C', street: 'D', houseNumber: '5', door: '7' })).toEqual({ city: 'A', district: 'B', neighborhood: 'C', street: 'D', buildingNo: '5', doorNo: '7' });
  });

  it('flags a guessed number so the app can say the point may be approximate', async () => {
    const result = toAppResolve(await search.resolve('Zeytin Sokak 3'));
    expect(result).toMatchObject({ kind: 'resolved', precision: 'address', approximate: true });
  });

  it('keeps only the hinted district when a street name is typed', async () => {
    const hints = { city: 'İstanbul', district: 'Üsküdar' };
    const result = toAppResolve(await search.resolve('Gül Sokak 12', { hints }), hints);
    expect(result).toMatchObject({ kind: 'resolved', location: { addressDetails: { district: 'Üsküdar', street: 'Gül Sokak', buildingNo: '12' } } });
    const other = toAppResolve(await search.resolve('Gül Sokak 12', { hints: { district: 'Beşiktaş' } }), { district: 'Beşiktaş' });
    expect(other.kind).toBe('notFound');
  });

  it('answers a district name alone at district level whatever the position given', async () => {
    const plain = toAppResolve(await search.resolve('Kadıköy'));
    expect(plain).toMatchObject({ kind: 'resolved', precision: 'district', location: { addressDetails: { district: 'Kadıköy' } } });
    const near = toAppResolve(await search.resolve('Kadıköy', { near: [28.9, 40.9] }));
    expect(near).toMatchObject({ kind: 'resolved', precision: 'district' });
  });

  it('gives suggestions for half a street name', async () => {
    const candidates = (await search.autocomplete('bahar')).map(toCandidate);
    expect(candidates[0]).toMatchObject({ precision: 'street', title: 'Bahariye Caddesi' });
  });

  it('answers a place name with the name the app shows', async () => {
    expect(toAppResolve(await search.resolve('kadikoy belediye binasi'))).toMatchObject({ kind: 'resolved', location: { name: 'Kadıköy Belediyesi' } });
  });
});

describe('refining an address the way the app does', () => {
  it('moves to the door and keeps what was typed, including the door number', async () => {
    const moved = await refine(search, { city: 'İstanbul', district: 'Kadıköy', neighborhood: 'Moda', street: 'Zeytin Sokak', buildingNo: '5', doorNo: '3' });
    expect(moved).toMatchObject({ kind: 'moved', precision: 'address', latitude: 40.72, longitude: 28.654, details: { street: 'Zeytin Sokak', buildingNo: '5', doorNo: '3', district: 'Kadıköy' } });
  });

  it('keeps the address when the answer is another district or only coarse', async () => {
    expect(await refine(search, { city: 'İstanbul', district: 'Üsküdar', street: 'Zeytin Sokak', buildingNo: '5' })).toEqual({ kind: 'kept' });
    expect(await refine(search, { city: 'İstanbul', district: 'Kadıköy', street: 'Olmayan Yol', buildingNo: '1' })).toEqual({ kind: 'kept' });
  });
});
