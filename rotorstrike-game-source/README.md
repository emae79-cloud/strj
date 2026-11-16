# ROTOR STRIKE

Tarayıcıda oynanan, gerçekçi uçuş hissi hedefleyen **3D drone savaş oyunu**. Bir quadcopter'ı
birinci şahıs gimbal kameradan uçurur, görünür silah olmadan nişangâh üzerinden düşman dronları
vurursunuz. Her drone **4 can** taşır: dört isabetli vuruş alan düşer. Uçuş sırasında kredi
kazanır, hangarda yeni dronlar ve yükseltmeler satın alırsınız.

Teknoloji: **Three.js 0.186 + Rapier 0.21 + Vite + TypeScript**, sabit 60 Hz simülasyon.
Bütün 3D varlıklar (dronlar, arena, dokular) kodla üretilir; harici model dosyası yoktur.

## Çalıştırma

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # varlık geri yükleme + tür denetimi + üretim derlemesi + boyut/paylaşım hazırlığı
pnpm typecheck
pnpm test     # birim testleri (rules, save, hangar, i18n, input, tuning, loop)
node scripts/check-size.mjs # derlemeden sonra JS/font bütçeleri
pnpm smoke    # derleme sonrası: headless tarayıcıda uçuş ve ekran turları, shots/ altına görüntü
```

## Kontroller

Telefonda en kolay kullanım: **soldaki büyük çubuğu sürükle ve uç**, **ekranın sağ tarafını sürükle ve bak**, **ATEŞ düğmesine basılı tut**. YÜKSEL/ALÇAL düğmeleri irtifayı ayarlar; stabilizasyon başlangıçta açıktır.

| Eylem | Klavye / Fare | Gamepad | Dokunmatik |
| --- | --- | --- | --- |
| İleri / geri | `W` / `S` | Sol çubuk | Sanal çubuk |
| Yana kayma | `A` / `D` | Sol çubuk | Sanal çubuk |
| Tırman / alçal | `Boşluk` / `Shift` | A / B | YÜKSEL / ALÇAL düğmeleri |
| Ateş | Sol tık veya `F` | RT | ATEŞ düğmesi |
| Nişan | Fare | Sağ çubuk | Sağ yarıda sürükleme |
| Stabilizasyon | `X` | Y | — |
| Duraklat | `Esc` / `P` | Start | Duraklat düğmesi |

**Ayarlar → Kontrol modu** bölümünde Otomatik, PC veya Android seçilebilir. Otomatik mod Android
dokunmatik cihazında sanal kontrolleri gösterir; PC'de mobil düğmeler gizli kalır. PC'de yatay ve
dikey bakış fareyle, Android'de ekranın sağ tarafını sürükleyerek yönetilir. Stabilizasyon açıkken
yerçekimi büyük ölçüde telafi edilir; kapatınca saf atalet/sürüklenme hissedilir.

Silah basılı tutulduğunda kontrollü otomatik ateş eder (yaklaşık **5 atış/sn**). **20 mermi**
bittiğinde şarjör otomatik olarak tam **5 saniyede** dolar; HUD kalan süreyi ve mühimmatı gösterir.

## Oynanış

- **Dalgalar:** hafif (ARICI), ağır (KALKAN) ve keskin nişancı (ATMACA) düşmanlar; her dalgada
  sayı ve isabet şansı artar.
- **Ekonomi:** isabet +25, düşürme tip primi (120 / 200 / 260), dalga primi `220 × (1 + 0,25×(dalga−1))`,
  hayatta kalma saniyede +3 kredi. Sonuç ekranı kazançları ayrıştırır.
- **Hangar:** 6 drone (RQ-1 ARICI, SK-2 YILDIRIM, TB-3 KALKAN, AC-4 TOPÇU, VX-5 ATMACA,
  PR-6 HAYALET) farklı hız/manevra/ateş/menzil istatistikleriyle; silah, motor ve gövde
  yükseltmeleri (her biri 4 kademe).
- **Kalıcılık:** kredi, sahiplik, seçili drone, yükseltmeler, rekor ve ayarlar `localStorage`'da
  (v3 şema; eski v2 kayıtları yükseltilir, bozuk kayıt güvenli biçimde sıfırlanır).

## Yapı

| Yol | Görev |
| --- | --- |
| `src/engine/loop.ts` | Sabit 60 Hz simülasyon + interpolasyonlu render |
| `src/engine/input.ts` | Klavye/fare/gamepad/dokunmatik → tek eylem durumu |
| `src/engine/physics.ts` | Rapier dünyası, collider yardımcıları, gövde senkronizasyonu |
| `src/engine/save.ts` | Sürümlü kayıt şeması ve doğrulama |
| `src/engine/audio.ts` | Sentezlenmiş ses efektleri ve ses busları |
| `src/game/config.ts` | Oynanış ayarlarının tek kaynağı (`CONFIG`) |
| `src/game/rules.ts` | Saf koşu/dalga/ekonomi kuralları (birim testli) |
| `src/game/player.ts` | İtki, atalet, sürüklenme, çarpışma, şarjör ve doldurma |
| `src/game/camera.ts` | Birinci şahıs gimbal kamera, sarsıntı, geri tepme |
| `src/game/weapons.ts` | İz mermileri, ışın-küre isabet testi, saçılma |
| `src/game/enemies.ts` | Düşman AI (kovalama, manevra, ateş) ve tipleri |
| `src/game/arena.ts` | Çöl kanyonu + endüstriyel şehir, ışık, gökyüzü, sis |
| `src/game/textures.ts` | Prosedürel kum/kaya/beton/asfalt/cephe dokuları |
| `src/game/models.ts` | Prosedürel katlanır kameralı dron modelleri ve görünmez atış noktası |
| `src/game/hangar.ts` | Dron kataloğu, yükseltmeler, yük denklemi |
| `src/game/tuning.ts` | Geliştirme moduna özel Tweak kataloğu |
| `src/ui/ui.ts` | Bütün ekranlar, HUD, klavye/gamepad gezinme |
| `src/i18n/tr.json` | Türkçe metinlerin tamamı (tek dil) |

## Varlıklar ve lisanslar

- 3D modeller, dokular ve sesler kodla üretilir; ücretli model üretimi kullanılmadı.
- Tipografi: **Barlow** ve **Barlow Condensed** (Google Fonts, SIL Open Font License 1.1),
  `public/fonts/` altında woff2 olarak paketlenmiştir; lisans dosyaları aynı dizindedir.
- Simge ve paylaşım görselleri: `public/favicon.png`, `assets/share/og.png` (1200×630),
  `assets/share/favicon.png`.

## Paylaşım

`game-sharing.json` başlık, açıklama ve sosyal medya metinlerini taşır;
`scripts/manus-game-sharing/build.mjs` derleme sırasında OG/favicon etiketlerini `dist/index.html`
içine yazar. Yayınlama ayrı bir onay adımıdır.


## Çevrimiçi oda ve takma ad

Ana menüden **Çevrimiçi Oda**'yı seç, 18 karaktere kadar takma ad gir ve **Oda Oluştur**'a bas. Arkadaşına görünen 6 karakterli oda kodunu veya oyundaki **Davet Linkini Kopyala** düğmesini gönder; arkadaşın kodu girip **Kodla Katıl** der. Takma ad bu cihazın yerel kaydında tutulur; hesap gerekmez. Odalar iki kişiliktir ve geçicidir.

Çevrimiçi bağlantı, Render'da sunucu oluşturulup yayımlandıktan ve gerçek WSS adresi `public/multiplayer/bootstrap.json` içine yazıldıktan sonra çalışır. Yapılandırma yokken oyun açıkça sunucunun ayarlanmadığını gösterir; tek oyunculu oyun değişmeden oynanabilir. Adım adım Render kurulumu için [`server/README.md`](server/README.md) dosyasına bak. Burada Render servisi oluşturulmadı, WSS adresi eklenmedi, test/build/typecheck veya oyun yayını yapılmadı.
