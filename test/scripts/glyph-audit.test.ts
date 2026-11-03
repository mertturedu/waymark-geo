import { auditRows, renderTable, sampleOf, suspect } from '../../scripts/glyph-audit';

describe('suspect', () => {
  it('flags a name that says one thing while the glyph says another', () => {
    expect(suspect('Halil Aslan Kahvesi', 'art-gallery')).toContain('kahve');
    expect(suspect('Merkez Eczanesi', 'shop')).toContain('eczane');
    expect(suspect('Yeni Camii', 'none')).toContain('cami');
  });

  it('accepts names whose glyph fits', () => {
    expect(suspect('Merkez Eczanesi', 'pharmacy')).toBeNull();
    expect(suspect('Yeni Camii', 'mosque')).toBeNull();
    expect(suspect('Moda Kafe', 'cafe')).toBeNull();
    expect(suspect('Atatürk Ortaokulu', 'school')).toBeNull();
    expect(suspect('Migros', 'grocery')).toBeNull();
    expect(suspect('', 'none')).toBeNull();
  });

  it('reads Turkish capitals', () => {
    expect(suspect('GÜNEŞ ECZANESİ', 'bank')).toContain('eczane');
    expect(suspect('KAHVE DÜNYASI', 'cafe')).toBeNull();
  });
});

describe('sampleOf', () => {
  const items = Array.from({ length: 50 }, (_, i) => i);

  it('is the same for the same seed and different for another', () => {
    expect(sampleOf(items, 10, 5)).toEqual(sampleOf(items, 10, 5));
    expect(sampleOf(items, 10, 5)).not.toEqual(sampleOf(items, 10, 6));
  });

  it('takes distinct items, never more than there are, and leaves the input alone', () => {
    const copy = [...items];
    const taken = sampleOf(items, 10, 1);
    expect(new Set(taken).size).toBe(10);
    expect(sampleOf(items, 99, 1)).toHaveLength(50);
    expect(sampleOf([], 5, 1)).toEqual([]);
    expect(items).toEqual(copy);
  });
});

describe('auditRows and renderTable', () => {
  const rows = auditRows([{ name: 'Yeni Camii', cat: 'retirement_home', g: 'other' }, { name: 'Moda Kafe', cat: 'cafe', g: 'food' }, { name: 'Bir Yer', cat: 'x' }]);

  it('looks the glyph up with the name fallback', () => {
    expect(rows.map((row) => row.glyph)).toEqual(['mosque', 'cafe', 'none']);
    expect(rows.every((row) => row.reason === null)).toBe(true);
  });

  it('writes the suspects first and counts them', () => {
    const bad = auditRows([{ name: 'Güneş Eczanesi', cat: 'bank', g: 'money' }, { name: 'Moda Kafe', cat: 'cafe', g: 'food' }]);
    const text = renderTable('34', bad);
    expect(text).toContain('2 örnek, 1 şüpheli (50%)');
    expect(text.indexOf('Güneş Eczanesi')).toBeLessThan(text.indexOf('## Tüm örnekler'));
    expect(renderTable('34', [])).toContain('0 örnek, 0 şüpheli (0%)');
    expect(renderTable('34', [{ name: 'a|b', cat: 'c', g: null, glyph: 'none', reason: null }])).toContain('a\\|b');
  });
});
