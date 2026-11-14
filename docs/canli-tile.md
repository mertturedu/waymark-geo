# Canlı tile (indirilmemiş bölgeyi sunucudan okuma)

Paketi indirilmiş bölge dosyadan çizilir. İndirilmemiş bölge, bir tile sunucusundan (`z/x/y`) canlı okunabilir.
İki yol aynı haritada birlikte çalışır: base, yazı tipleri ve ikonlar hep yereldir, yalnızca bölge tile'ları değişir.

## Ayar

```ts
<GeoProvider config={{ manifestUrl, publicKeys, tiles: { url: 'https://tile.example.com' } }}>
```

`tiles` verilmezse hiçbir şey değişmez, harita yalnızca indirilmiş bölgeleri çizer.

## Hangi bölge okunur?

Uygulama haritanın nereye baktığını bildirir:

```ts
const geo = useGeo();
geo.map.stream.set([[lng, lat], ...]);
```

Noktayı içeren, indirilmemiş ve manifestte `tiles` dosyası olan bölgeler okunur (en çok `MAX_STREAMED`, 3).
Haritanın yazı tipleri, simgeleri ve genel görünümü "taban paketi"nde durur (yaklaşık 16 MB) ve her zaman yereldir.
Canlı okuma ayarlıysa ve taban inmemişse `stream.set` onu kendiliğinden indirir (mobil veriyle de), hiçbir bölge indirilmemiş olsa bile.
Elle de istenebilir: `geo.regions.downloadBase()`, hazır mı diye `geo.regions.baseReady()`. Canlı okuma açıkken son bölge silinse de taban silinmez.
Bölge sonradan indirilince stil kendiliğinden dosyaya geçer. `useMapStyle` değişikliği izler, ayrıca bir şey gerekmez.
`only` verilmişse liste uygulamanın kendisidir, canlı okuma eklenmez.

## Sunucu tarafı

Tile adresi manifestteki dosya yolundan türetilir: `34/tiles-6f086fc5.mlt.pmtiles` dosyası
`<url>/34/tiles-6f086fc5.mlt/{z}/{x}/{y}.mlt` olarak istenir (düz vektör arşivde `.mvt`).
`tiles`, `places` ve `transit` dosyaları aynı kuralla okunur; bu dosyalar sunucunun deposunda manifestteki yollarıyla durmalıdır.
Kurulum: `yuksi/tile-server`.
