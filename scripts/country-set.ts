import type { AdminResult } from '../src/core/address/admin';
import type { Search } from '../src/core/address/search';

export async function adminLookupSet(search: Search, plate: string, count: number): Promise<{ lookups: { sid: string; expected: string }[]; admin: { query: Record<string, string>; expected: string }[] }> {
  const lookups: { sid: string; expected: string }[] = [];
  const admin: { query: Record<string, string>; expected: string }[] = [];
  const keep = async (query: Record<string, string>): Promise<AdminResult | null> => {
    const result = await search.admin(query);
    if (result) admin.push({ query, expected: JSON.stringify(result) });
    return result;
  };
  const districts = await keep({ province: plate });
  for (const d of districts?.items.slice(0, 4) ?? []) {
    lookups.push({ sid: d.id, expected: JSON.stringify(await search.lookup(d.id)) });
    const hoods = await keep({ district: d.id });
    for (const h of hoods?.items.slice(0, 3) ?? []) {
      lookups.push({ sid: h.id, expected: JSON.stringify(await search.lookup(h.id)) });
      const streets = await keep({ hood: h.id });
      for (const s of streets?.items.slice(0, 3) ?? []) {
        if (lookups.length < count) lookups.push({ sid: s.id, expected: JSON.stringify(await search.lookup(s.id)) });
        await keep({ street: s.id });
      }
    }
  }
  return { lookups, admin };
}
