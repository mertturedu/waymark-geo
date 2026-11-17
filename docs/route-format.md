# Rota paketi biçimi (sürüm 1 ve 2)

Her il için tek dosya (`route-<özet>.bin`, manifestte `kind: route`). Sayılar küçük endian. "varint" 7 bitlik gruplarla yazılan işaretsiz tam sayıdır (en çok 5 bayt, 32 bit), "zigzag" işaretli sayının `v >= 0 ? 2v : -2v - 1` ile varint'e çevrilmiş halidir. Koordinatlar mikro derece (derece x 1e6).

## Başlık (44 bayt)

| Konum | Boyut | Anlam |
|---|---|---|
| 0 | u32 | sihirli sayı `0x54524759` (`YGRT`) |
| 4 | u16 | sürüm (1 ya da 2) |
| 6 | u16 | bayraklar (0) |
| 8 | u32 | hiyerarşi düğüm sayısı (kavşaklar + dönüş kopyaları) |
| 12 | u32 | temel kavşak sayısı |
| 16 | u32 | yol parçası sayısı (yönsüz) |
| 20 | 4 x i32 | kutu: batı, güney, doğu, kuzey |
| 36 | u32 | ayrılmış |
| 40 | u32 | bölüm sayısı |

Hemen ardından bölüm tablosu: her bölüm için `u8 kimlik, u32 başlangıç, u32 uzunluk` (9 bayt). Bölümler dosyanın başından başlayan mutlak konumlardadır. Okuyucu her bölümün dosya içinde kaldığını doğrular.

## Bölümler

1. **Düğümler.** Her temel kavşak için: `zigzag Δboylam`, `zigzag Δenlem` (öncekine göre), `varint hiyerarşi düğümü`.
2. **Yol parçaları.** Her parça için: `zigzag Δbaşlangıç` (önceki parçanın başlangıcına göre), `zigzag (bitiş - başlangıç)`, `varint bayraklar`, `varint uzunluk (m)`, `varint ileri süre`, `varint geri süre` (desisaniye, kavşak cezası olmadan; yön yoksa 0), `varint şekil bayt sayısı`.
   Bayraklar: bit 0 ileri geçilebilir, bit 1 geri geçilebilir, bit 2 ana ağda, bit 3 ileri yönde kavşak cezası var, bit 4 geri yönde kavşak cezası var, bit 5 ve üstü yol sınıfı (`src/core/route/speeds.ts` içindeki `ROAD_CLASSES` sırası).
   Yönlü yay kimliği `pa = 2 x parça + yön` (yön 0: başlangıçtan bitişe, 1: tersi).
3. **Şekiller.** Parçaların ara noktaları arka arkaya: `varint nokta sayısı`, sonra her nokta için `zigzag Δboylam`, `zigzag Δenlem` (başlangıç düğümünden başlayarak). Parçanın bayt aralığı yol parçaları bölümündeki şekil bayt sayılarından bulunur.
4. **Yukarı yaylar** ve 5. **Aşağı yaylar** (contraction hierarchies). Düğüm kimliği sıralama sırasıdır: yukarı yayın hedefi her zaman daha büyük kimliklidir. Önce `varint toplam yay sayısı`, sonra her düğüm için `varint sayı` ve o kadar kayıt: `varint hedef farkı` (ilk kayıtta `hedef - düğüm - 1`, sonrakilerde önceki hedefe göre), `varint süre`, `varint uzunluk (m)`, `varint via`. `via` düşük bitte 1 ise özgün yaydır ve `via >> 1` yönlü yay kimliğidir; 0 ise kısayoldur ve `via >> 1` ortadaki düğümdür (her zaman bu düğümden küçük).
   Yukarı listede düğümden daha yüksek sıralı düğüme giden yaylar, aşağı listede daha yüksek sıralı düğümden bu düğüme gelen yaylar durur (geriye doğru arama için).
6. **Giriş tablosu.** Dönüş yasağı yüzünden kopyası olan yönlü yaylar: `varint sayı`, sonra `varint Δyay kimliği`, `varint düğüm` (yayı bitirince varılan düğüm).
7. **Çıkış tablosu.** Bir yaya başlanabilecek kopya düğümler (kök düğüm dışında): `varint sayı`, sonra `varint Δyay kimliği`, `varint düğüm`.
8. **Izgara.** `zigzag başlangıç boylamı`, `zigzag başlangıç enlemi`, `varint hücre boyu (5000)`, `varint sütun`, `varint satır`, sonra her hücre için `varint kayıt sayısı`, sonra her hücrenin yol parçası kimlikleri (`varint` artan fark).

## Sürüm 2: ayna yaylar

Yukarı ve aşağı yay bölümleri dışında her şey sürüm 1 ile aynıdır.

- Yukarı yay kaydındaki `via` bir bit daha taşır: yazılan değer `2 x via + ayna`. `ayna` 1 ise bu yayın tersi aynı düğümün aşağı listesindedir ve aşağı bölüme yazılmaz. Tersi: aynı uç düğüm, aynı süre ve uzunluk; özgün yayda yönlü yay kimliğinin yön biti çevrilir (`pa ^ 1`), kısayolda ortadaki düğüm aynı kalır.
- Aşağı bölümde yalnızca aynası olmayan yaylar durur (toplam sayı da onların sayısıdır).
- Okuyucu her düğümün aşağı listesini uç düğüme göre sıralı birleştirerek kurar; sonuç sürüm 1 dosyasının listesiyle birebir aynıdır. Ayna yalnızca aşağı listede o uç düğüme giden tek yay varsa kullanılır; aynı uç düğüm iki kez çıkarsa dosya bozuk sayılır.
- Sürüm 2 paketi içeren manifestin `minSdk` değeri en az `0.6.0`'dır. Paket hattı sürüm 2'yi SDK sürümü 0.6.0 ya da üstündeyse yazar; `GEO_ROUTE_FORMAT=1|2` bunu zorlar. `rewriteRoutePack` (`pipeline/build/route-pack.ts`) bir dosyayı yeniden kurmadan iki sürüm arasında çevirir.

## Süre ve ağırlık

Ağırlıklar desisaniyedir (0,1 sn). Bir yönlü yayın ağırlığı yol türü, `maxspeed`, çevredeki kavşak yoğunluğu ve kavşaklar arası uzunlukla hesaplanan süre (`roadKmh`) artı, varış kavşağında en az üç yol buluşuyorsa, yol türüne göre kavşak cezasıdır (`speeds.ts`). Dönüş yasakları yerel kopya düğümlerle uygulanır; sola dönüş cezası yoktur.

## Okuyucu kuralları

Bozuk girdi için okuyucu `route_pack_corrupt` kodlu hata fırlatır; asla sonsuz döngüye girmez. Sayılar dosya boyutundan büyük olamaz, her düğüm ve yol parçası kimliği aralıkta olmalı, kısayolun ortası kendi düğümünden küçük olmalıdır.
