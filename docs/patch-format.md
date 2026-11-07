# Yama biçimi (fark güncellemesi)

Yama isteğe bağlı hızlandırmadır. Yoksa, bozuksa ya da uygulanamıyorsa SDK aynı dosyayı tam indirir. Yama uygulanmış dosya tam indirilmişle bayt bayt aynıdır (sha256 manifestteki değerle eşleşmek zorunda).

## Manifest kaydı

Dosya kaydına (`files[]`, `base[]` dışında bölge dosyaları) isteğe bağlı `patches` dizisi eklenir:

```json
{
  "kind": "tiles",
  "path": "34/tiles-6f086fc5.mlt.pmtiles",
  "size": 47090000,
  "sha256": "<yeni dosya>",
  "patches": [
    { "from": "<eski dosyanın sha256'sı>", "codec": "zstd-patch-seg", "path": "34/patches/6f086fc5-from-e54e9d46.zpatch", "size": 8200000, "sha256": "<yama dosyası>", "segment": 8388608, "margin": 4194304 }
  ]
}
```

| Alan | Anlam |
|---|---|
| `from` | Yamanın uygulanacağı eski dosyanın sha256'sı (sürüm adı değil). Telefondaki dosyanın özetine uyan yama seçilir. |
| `codec` | Şimdilik yalnızca `zstd-patch-seg`. Başka değer yamayı geçersiz sayar. |
| `path` | Yama dosyasının yolu (`checkPath` kuralları, dosyanın kendi ya da `encoded` yoluyla aynı olamaz). |
| `size`, `sha256` | Yama dosyasının boyutu (> 0) ve özeti. |
| `segment` | Çıktı dilim boyu (bayt, > 0). Varsayılan 8 MiB. |
| `margin` | Eski dosyada referansa eklenen pay (bayt, >= 0). Varsayılan 4 MiB. |

İmza tüm manifesti kapsar, yamalar ayrıca imzalanmaz.

### Okuyucu kuralları

- Bozuk bir yama kaydı manifesti reddettirmez: yalnız o kayıt atılır (yanlış tür, kötü özet, `from` dosyanın kendi özeti, geçersiz yol, sıfır boyut, eksik alan).
- Aynı `from` ya da aynı `path` iki kez geçerse ilki kalır.
- Kullanılabilir yama kalmazsa `patches` alanı hiç oluşmaz.
- `patches` dizi değilse yok sayılır.
- Eski SDK'lar dosya kaydındaki bilinmeyen alanı yok sayar, yani yamalı manifest onları bozmaz (0.6.0 öncesi sabitleme `6d5832b` ile çalıştırılarak doğrulandı).

## Yama dosyası (`.zpatch`)

Sayılar küçük endian.

| Konum | Boyut | Anlam |
|---|---|---|
| 0 | u32 | sihirli sayı `0x54504759` (`YGPT`) |
| 4 | u16 | sürüm (1) |
| 6 | u16 | bayraklar (0) |
| 8 | u32 | yeni dosyanın boyu |
| 12 | u32 | eski dosyanın boyu |
| 16 | u32 | dilim sayısı `n` |

Hemen ardından `n` kayıtlık dizin, her kayıt 16 bayt: `u32 çıktı uzunluğu`, `u32 referans başlangıcı`, `u32 referans uzunluğu`, `u32 çerçeve boyu`. Sonra dilimlerin zstd çerçeveleri arka arkaya, dizindeki sırayla.

- Dilim `i` çıktıda `[Σ önceki uzunluklar, +uzunluk)` aralığını doldurur; son dilim kalanı taşır.
- Referans, eski dosyanın `[başlangıç, başlangıç + uzunluk)` aralığıdır ve zstd'ye önek (`refPrefix`) olarak verilir. Aralık dizinde açık yazıldığından üretici kaymayı dilim başına düzeltebilir, açıcı yalnızca dizine uyar.
- Üretici varsayılanı: `başlangıç = i·segment − margin`, uzunluk `segment + 2·margin` (dosya sınırlarına kırpılır).
- Açıcı, dizindeki her aralığın dosya içinde kaldığını, çıktı uzunluklarının toplamının yeni boyla ve çerçeve boylarının toplamının dosya sonuyla uyuştuğunu doğrular; uymazsa yama geçersizdir ve tam indirmeye düşülür.
- Sonuç dosyanın sha256'sı manifestteki `sha256` ile eşleşmezse yama atılır, tam indirme yapılır.

## Üretim (veri hattı)

`npm run data:build` yayın adımında (`pipeline/build/orchestrate.ts`, `pipeline/build/patches.ts`):

1. Yayınlanmış `dist/packs` (bir önceki sürüm) `dist/archive/<sürüm>/` altına sabit bağlantılarla arşivlenir: manifest ve bölge dosyalarının düz hali (`.zst` ve yamalar arşive girmez, disk neredeyse artmaz). Arşivde son `GEO_PATCHES` (varsayılan 3) sürüm kalır, daha eskisi silinir. `GEO_PATCHES=0` yama üretimini ve arşivlemeyi kapatır.
2. Yeni sürümün her bölge dosyası için, arşivdeki her eski sürümde aynı bölgede aynı türden **farklı özetli** dosya varsa (aynı eski özet iki sürümde varsa tek yama) bir yama üretilir. 1 MiB'tan küçük dosyalara yama yapılmaz.
3. Her dilim için iki aday referans aralığı denenir, küçük çıkan seçilir: sabit konum (`i·segment − margin`) ve eski/yeni boy oranıyla ölçeklenmiş konum. Seçilen aralık dizine yazılır. Yeni dosya eskisinden uzunsa referansı olmayan dilim düz zstd çerçevesi olur (`refLength = 0`).
4. Sıkıştırma: `zstd -19 -T1 --long=26 --patch-from=<referans>` (tek iş parçacığı, çıktı her koşuda aynı). Pencere 64 MiB, referans en çok `segment + 2·margin` = 16 MiB.
5. Üretimden hemen sonra yama dilim dilim eski dosyaya geri uygulanır ve birleşen dosyanın sha256'sı yeni dosyayla karşılaştırılır; tutmayan yama atılır, manifeste girmez.
6. Yama, indirilecek tam dosyanın (`encoded` varsa onun) **%85'inden büyükse** atılır. Bu karar önbelleğe yazılır (`.none`), aynı çift bir daha denenmez.
7. Doğrulanmış yamalar `<plaka>/patches/<tür>-<yeni özet 8>-from-<eski özet 8>.zpatch` yoluna yazılır; manifestte dosya kaydında `from` özetine göre sıralı durur.

Önbellek `dist/work/<tarih>/patch-cache/` (anahtar: eski özet, yeni özet, dilim, pay, zstd düzeyi, pencere). Yeniden koşuda doğrulanmış yama aynen kullanılır; önbellek silinirse aynı baytlar yeniden üretilir.

`pipeline/validate/validate-packs.ts` her yama için dosyanın varlığını, boyutunu, sha256'sını, başlık ve dilim dizininin geçerliliğini ve yeni dosya boyunun manifestle uyuşmasını denetler.

## Uygulama (telefon)

`src/core/packs/patch-apply.ts` içindeki `applyPatchFile` yamayı yeni dosyaya çevirir. Yerel kod, Expo modülü ya da yeni bağımlılık yoktur; çözücü `src/core/packs/fzstd.ts` içindeki `decompressInPlaceSteps`'tir (zstd önek desteği, iki platformda aynı JS).

1. Yamanın başlığı ve dilim dizini okunur, dosya boyuyla tutarlılığı ve eski dosyanın boyu denetlenir (`patch`/`old` hatası).
2. Çıktı dosyası sıfırlanır. Her dilimde referans aralığı eski dosyadan, çerçeve yama dosyasından 1 MiB'lık parçalarla tek bir **yeniden kullanılan** çalışma tamponuna okunur (`en büyük referans + en büyük dilim`, bu biçimde en çok 24 MiB) ve çerçeve tamponun referans sonrasına açılır. Her dilim için yeni tampon ayrılmaz: Hermes'te büyük tamponlar çöp toplayıcı yetişmeden birikir (16 dilimde ~115 MB, yeniden kullanımda ~35 MB).
3. Açma blok başına (en çok 128 KB) duraklayabilir: `budgetMs` (varsayılan 8 ms) dolunca `pause()` çağrılır, böylece JS iş parçacığı serbest kalır. Dilim bitince ayrıca `pause()` çağrılır.
4. Açılan dilim çıktı dosyasına eklenir (`append`), ilerleme `onProgress(done, total)` ile bildirilir.
5. Tüm dilimlerden sonra çıktının sha256'sı (`HashPort.sha256File`, native) beklenenle karşılaştırılır. Herhangi bir adımda hata olursa çıktı dosyası silinir ve neden döner: `patch` (yama bozuk/eksik), `old` (eski dosya yok ya da yamanın kaynağı değil), `decode` (zstd hatası), `sha256`, `io`. Çağıran bu durumda tam indirmeye düşer (Faz 4).

Tepe bellek: çalışma tamponu + en büyük çerçeve (8 MiB'a kadar) + 1 MiB'lık okuma parçaları, yaklaşık 40 MiB.

## Güncelleme akışı (SDK)

`src/core/packs/manager.ts`:

1. **Seçim.** Bölge dosyası kurulu sürümden farklıysa ve kurulu dosyanın sha256'sına uyan bir `patches` kaydı (`from`) varsa o dosya için iş türü "yama", yoksa "tam indirme". `PackConfig.patches: false` yamayı tümden kapatır. `base` dosyaları hiçbir zaman yamalanmaz.
2. **İndirme.** Yama, tam dosyayla aynı `downloadFile` yolundan iner (devam etme, ilerleme, sha256). `status(id).updateBytes` ve `downloadBytes(id)` yama boyunu verir; arayüz güncelleme satırında bu boyutu gösterir. İlerleme çubuğunun toplamı yama boyutlarıdır.
3. **Uygulama.** `applyPatchFile`, yeni dosyayı `.part/` altına yazar, sha256 doğrular, sonra `files/` altına taşır. Eski dosya güncelleme bitene kadar yerinde ve okunur kalır (harita ve arama çalışmaya devam eder); bölge kaydı ve eski dosyanın silinmesi bugünkü gibi en sonda `commit` içinde olur. Yama dosyası uygulamadan sonra silinir. Yer yoksa (kalan boş yer yeni dosyanın 1,2 katından azsa) yama atılır ve tam indirmeye düşülür; o da yetmezse `no-space` döner, eski dosyalar korunur.
4. **Geri düşüş.** Yama indirilemezse (404, HTTP hatası, sha256 uyuşmazlığı), uygulanamazsa (bozuk yama, eski dosya bozuk/başka, depolama hatası) yalnızca o dosya tam indirilir. Ağ tümden koptuysa (`network`) ya da kullanıcı iptal/duraklattıysa tam indirmeye düşülmez, hata olduğu gibi döner (iş `paused` ya da `error` olur, kaldığı yerden sürer).
5. **Rapor.** `status(id).lastUpdate = { patched, fellBack, bytes }`: son işte yamayla güncellenen dosya sayısı, yama denenip tam indirmeye düşen dosya sayısı ve indirilen toplam bayt. Bellekte tutulur (kalıcı değil); uygulama isterse kendi loguna yazar.
6. **Temizlik.** Manifestte listelenen yama dosyaları açılış taramasında silinmez (yarım kalan indirme devam edebilir), listelenmeyenler silinir. Bölge silinince yamaları da silinir.
