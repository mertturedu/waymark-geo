import { aggregate, allowedByRobots, htmlToText, parseSitemap, robotsDisallow, streetMentions, verifyClaim } from '../../scripts/municipal-lib';

describe('belediye metni', () => {
  it('HTML den metin çıkarır, betikleri atar, karakter kodlarını çözer', () => {
    const t = htmlToText('<head><title>x</title></head><script>var a=1</script><p>Yenip&#305;nar&nbsp;Caddesi &amp; Çay</p><div>ikinci</div>');
    expect(t).toBe('Yenipınar Caddesi & Çay\nikinci');
  });

  it('site haritasını ve indeksini ayırır', () => {
    expect(parseSitemap('<urlset><url><loc>https://a.bel.tr/x</loc></url></urlset>')).toEqual({ urls: ['https://a.bel.tr/x'], sitemaps: [] });
    expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.bel.tr/s1.xml</loc></sitemap></sitemapindex>').sitemaps).toEqual(['https://a.bel.tr/s1.xml']);
  });

  it('robots kurallarını uygular', () => {
    const rules = robotsDisallow('User-agent: bot\nDisallow: /a\nUser-agent: *\nDisallow: /admin\nDisallow:\n');
    expect(rules).toEqual(['/admin']);
    expect(allowedByRobots('/admin/x', rules)).toBe(false);
    expect(allowedByRobots('/haber', rules)).toBe(true);
  });
});

describe('sokak anmaları', () => {
  it('mahalleyle birlikte geçen sokağı bulur', () => {
    const m = streetMentions('Şehitler Mahallesi, Fevzi Çakmak Bulvarına ilişkin 1/1000 ölçekli plan değişikliği');
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ street: 'Fevzi Çakmak Bulvarı', hood: 'Şehitler' });
  });

  it('kısaltmaları ve rakamlı sokakları tanır', () => {
    const m = streetMentions('Gazi Mah. 1245 Sk. ile Yeni Pınar Cd. arasında');
    expect(m.map((x) => x.street)).toEqual(['1245 Sokağı', 'Yeni Pınar Caddesi']);
    expect(m[0]!.hood).toBe('Gazi');
  });

  it('küçük harfle başlayan sözcükleri ada katmaz', () => {
    const m = streetMentions('bu yolun Atatürk Caddesi üzerinde');
    expect(m[0]!.street).toBe('Atatürk Caddesi');
  });
});

describe('doğrulama', () => {
  const hoods = new Set(['igdir', 'sehitler']);
  const passage = 'İğdir Mahallesi Yenipınar Caddesi üzerindeki yol çalışması';
  it('alıntı metinde, sokak ve mahalle alıntıda ve mahalle resmî listede ise geçer', () => {
    expect(verifyClaim({ street: 'Yenipınar Caddesi', hood: 'İğdir', quote: 'İğdir Mahallesi Yenipınar Caddesi' }, passage, hoods).ok).toBe(true);
  });
  it('uydurma alıntıyı, eksik sokağı ve bilinmeyen mahalleyi reddeder', () => {
    expect(verifyClaim({ street: 'Yenipınar Caddesi', hood: 'İğdir', quote: 'İğdir Mahallesi Barış Caddesi' }, passage, hoods).reason).toBe('alıntı metinde yok');
    expect(verifyClaim({ street: 'Barış Caddesi', hood: 'İğdir', quote: 'İğdir Mahallesi Yenipınar Caddesi' }, passage, hoods).reason).toBe('sokak adı alıntıda yok');
    expect(verifyClaim({ street: 'Yenipınar Caddesi', hood: 'Kiralan', quote: 'İğdir Mahallesi Yenipınar Caddesi' }, passage, hoods).reason).toBe('mahalle alıntıda yok');
    expect(verifyClaim({ street: 'Yenipınar Caddesi', hood: 'İğdir', quote: 'İğdir Mahallesi Yenipınar Caddesi' }, passage, new Set(['x'])).reason).toBe('mahalle resmî listede yok');
  });
});

describe('toplama', () => {
  it('aynı sayfayı bir kez sayar, bağımsız sayfaları toplar', () => {
    const c = { street: 'Yenipınar Caddesi', hood: 'İğdir', quote: 'İğdir Mahallesi Yenipınar Caddesi' };
    const s = aggregate([{ claim: c, page: 'u1' }, { claim: c, page: 'u1' }, { claim: { ...c, street: 'Yenipınar Cad.' }, page: 'u2' }]);
    expect(s).toHaveLength(1);
    expect(s[0]!.pages).toEqual(['u1', 'u2']);
  });
});
