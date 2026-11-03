import { abbreviateName, lineCount } from '../../src/native/map/abbreviate';

describe('lineCount', () => {
  it('wraps greedily and keeps a long word whole', () => {
    expect(lineCount('Kadıköy')).toBe(1);
    expect(lineCount('Kadıköy Belediyesi')).toBe(2);
    expect(lineCount('Kadıköy Kültür Merkezi Konferans Salonu')).toBe(5);
    expect(lineCount('Abcdefghijklmnopqrstuvwxyz')).toBe(1);
  });
});

describe('abbreviateName', () => {
  it('leaves short names and names that fit two lines alone', () => {
    expect(abbreviateName('Moda Park')).toBe('Moda Park');
    expect(abbreviateName('Kadıköy Belediyesi')).toBe('Kadıköy Belediyesi');
    expect(abbreviateName('Kültür Merkezi')).toBe('Kültür Merkezi');
  });

  it('shortens common endings only when the name would pass two lines', () => {
    expect(abbreviateName('Kadıköy Kültür Merkezi Konferans Salonu')).not.toBe('Kadıköy Kültür Merkezi Konferans Salonu');
    expect(abbreviateName('Ataşehir Belediyesi Kültür Merkezi')).toBe('Ataşehir Bel. Kültür Mrk.');
  });

  it('stops as soon as the name fits', () => {
    expect(abbreviateName('Üsküdar Devlet Hastanesi Acil Servisi')).toBe('Üsküdar Devlet Hast. Acil Servisi');
  });

  it('shortens a leading word when the later words have no short form', () => {
    expect(abbreviateName('Merkezi Uzun Bir Ad Burada Yer Alır Hepsi')).toBe('Mrk. Uzun Bir Ad Burada Yer Alır Hepsi');
    expect(abbreviateName('Belediyesi Çok Uzun Bir Ad')).toBe('Bel. Çok Uzun Bir Ad');
  });

  it('keeps shortening one word after another while the name stays too long', () => {
    expect(abbreviateName('Sağlık Eğitim Araştırma Uygulama Merkezi Hastanesi')).toBe('Sağ. Eğt. Araş. Uyg. Mrk. Hast.');
  });

  it('returns the name unchanged when nothing can be shortened', () => {
    const name = 'Çok Uzun Bir Yer Adı Burada Daha Da Uzun';
    expect(abbreviateName(name)).toBe(name);
  });
});
