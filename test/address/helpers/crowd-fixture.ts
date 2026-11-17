import { address, admin, part, poi, square, where } from '../../pipeline/helpers/mini-work';
import type { Rows } from '../../pipeline/helpers/mini-work';
import { searchRows } from './search-fixture';

export function crowdRows(): Rows {
  const rows = searchRows();
  rows.admin.push(admin('r22', 8, 'r10', { tr: 'Yeni Moda Mahallesi' }, square(28.72, 40.5, 28.9, 41.0), [28.8, 40.7]));
  const lale = ['Lale Sokak', 'Lale Caddesi', 'Lalezar Sokak', 'Lale Çıkmazı', 'Lale Yolu', 'Lale Bulvarı', 'Lale Meydanı', 'Lale Sitesi', 'Lale Parkı', 'Lale Geçidi'];
  lale.forEach((name, i) => {
    const w = i % 2 === 0 ? where('r10', 'r20') : where('r11', 'r21');
    rows.streets.push(part(name, w, [[[28.7 + i * 0.001, 40.8], [28.7 + i * 0.001, 40.801]]], [`w${7000 + i}`]));
    rows.addresses.push(address(`n${7000 + i}`, name, '1', 28.7 + i * 0.001, 40.8, w));
  });
  rows.streets.push(part('Karanfil Sokak', where('r10', 'r20'), [[[28.75, 40.85], [28.751, 40.85]]], ['w7100'], {}, ['Lale Karanfil Yolu', 'Lale Sokağı']));
  rows.addresses.push(address('n7100', 'Karanfil Sokak', '2', 28.75, 40.85, where('r10', 'r20')));
  for (let i = 0; i < 12; i++) rows.places.push(poi(`n${8000 + i}`, 'pharmacy', 'Ada Eczanesi', 28.8 + i * 0.001, 40.7, i % 3 === 0 ? where('r11', 'r21') : where('r10', 'r20')));
  rows.places.push(poi('n8101', 'mall', 'İstanbul', 28.62, 40.66, where('r10', 'r20')));
  rows.places.push(poi('n8100', 'cafe', 'Ada Kahvesi', 28.81, 40.71, where('r10', null)));
  rows.addresses.push(address('n7301', null, '7', 28.64, 40.75, where('r10', 'r20')), address('n7302', null, '7', 28.60, 40.76, where('r10', 'r20')), address('n7303', null, '9', 28.65, 40.76, where('r10', 'r20')), address('n7304', null, '9', 28.65002, 40.76, where('r10', 'r20')));
  rows.addresses.push(address('n7200', 'Deniz Sokak', '1', 28.8, 40.7, where('r10', 'r22')));
  rows.streets.push(part('Deniz Sokak', where('r10', 'r22'), [[[28.8, 40.7], [28.801, 40.7]]], ['w7200']));
  return rows;
}
