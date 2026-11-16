# ROTOR STRIKE — Uygulama Planı

Tarayıcıda oynanan Türkçe 3D drone çatışma oyunu. Oyuncu kompakt, katlanır kollu kamera dronunu birinci şahıs gimbal görünümünden uçurur; nişangâhla düşman dronları vurup kredi kazanır ve hangardan yeni drone satın alır. Tek oyunculu dalga akışına ek olarak oda koduyla arkadaşlarla çevrimiçi drone düellosu ve takma ad eklenir. Her dron dört can taşır. Proje mevcut Three.js/Rapier altyapısını ve kaydedilmiş yerel ilerlemeyi korur.

## Teknik yaklaşım

- **Motor ve döngü:** Mevcut Three.js 0.186, Rapier 0.21, TypeScript ve Vite projesi korunur. Sabit 60 Hz simülasyon, tek giriş katmanı, proje Tweak yöneticisi ve sürümlü `localStorage` kaydı yeniden kullanılır.
- **Uçuş ve görüş:** İtki, atalet, sürüklenme, stabilizasyon, çarpışma ve hızlandırılmış uçuş aynı fizik katmanında kalır. Fare yaw/pitch bakışını tam dönüşe izin verecek şekilde yönetir; sanal çubuk ve sağ alan sürüklemesi Android'e göre çalışır. Birinci şahıs görünümünde gövdenin yalnız alt kenarı ve kamera/ön kol ayrıntıları ufku kapatmadan görünür.
- **Çatışma:** Görünür silah veya namlu çizilmez; merkezdeki nişangâh ve hitscan isabetleri kullanılır. Basılı ateş yaklaşık saniyede 5 atış üretir (kesin tavan 5,8); her şarjör 20 mermidir ve boşalınca sabit 5 saniyede otomatik dolar. İsabet başına bir hasar, her drone için dört isabet kuralı korunur. HUD mühimmatı ve kalan doldurma süresini gösterir.
- **Kontroller:** Ayarlarda Otomatik / PC / Android tercihi kaydedilir. Otomatik mod Android cihazı dokunmatik/pointer ipuçlarıyla tanır; sanal hareket çubuğu, bakış sürüklemesi ve ateş/yüksel/alçal düğmeleri yalnızca dokunmatik modda görünür ve çalışır. PC klavye/fare girişleri ve mevcut gamepad desteği korunur.
- **Düşük donanım:** Başlangıç grafik kalitesi cihaz ipuçlarına göre seçilir; az çekirdekli veya az bellekli cihaz düşük kaliteyle, diğer dokunmatik cihazlar orta kaliteyle başlar. Düşük preset piksel oranını 1 ile sınırlar ve gölge, bloom ve antialiasing'i kapatır. Oyuncu ayarlardan kaliteyi elle değiştirebilir.
- **Ses ve ilerleme:** Mevcut sentezlenmiş tuş/ateş sesleri ile sürekli döngülü müzik korunur; şarjör doldurma için kısa sentezli başlangıç/bitiş geri bildirimi vardır. Koşu kredileri, drone satın alma, mevcut kayıt ilerlemesi ve v2→v3 güvenli geçiş sürdürülür.
- **Çevrimiçi oyun:** Ayrı Node.js/WebSocket hizmeti Render Web Service olarak dağıtılır; mevcut statik oyun sayfası Manus'ta kalır. Oyuncular oda koduyla katılır, güvenli takma adlar ve diğer dronların etiketleri görünür. İstemci kendi uçuşunu gecikmesiz işler; sunucu oda üyeliği, can, hasar, atış hızı ve düşürme sonuçlarını doğrular. Render genel WSS bağlantılarını ve TLS'i destekler ([WebSocket rehberi](https://render.com/docs/websocket)); Render Free hizmeti 15 dakika HTTP/WebSocket girişi olmadığında uykuya geçer, yeni bağlantıyla yaklaşık bir dakikada uyanır ve her ay 750 çalışma saati sınırı taşır ([Free sınırları](https://render.com/docs/free)). Bellek içi odalar uyku/restart/deploy sırasında kapanır; hesap, kalıcı çevrimiçi profil, liderlik tablosu, ödeme ve veritabanı eklenmez. Free katman hobi/prototip içindir; sürekli açık hizmet gerekirse Render'ın 512 MB planı $7/aydan başlar, ücretli compute dağıtımı için ayrıca onay alınır ([fiyatlandırma](https://render.com/pricing)). Gerçek Render hizmeti ve WSS URL'si oluşmadan istemciye sahte/yer tutucu endpoint yazılmaz.
- **Görsel model:** Harici model gerektirmeyen, paylaşılan geometrilerle yapılan düşük çizim yüklü prosedürel kamera drone'u kullanılır: pah kırılmış gövde, katlanma pimleri, ince kollar, motorlar, pervaneler ve gimbal kamera. Altı drone varyantında biçim ve renk farklılıkları korunur; görünür silah parçaları bulunmaz. Mevcut arena ve Türkçe arayüz korunur.

## Proje yapısı

```text
src/
  engine/       input.ts: PC/Android/otomatik giriş; save.ts: v3 kayıt; audio.ts: SFX/BGM;
                renderer.ts: düşük/orta/yüksek kalite; loop.ts, physics.ts ve i18n.ts
  net/          WebSocket istemci bağlantısı, oda akışı, kimlikli mesaj ve uzaktaki oyuncu durumları
  game/         config.ts: uçuş/ateş/şarjör dengesi; player.ts: hareket ve yeniden doldurma;
                models.ts: prosedürel katlanır kamera dronu; camera.ts: birinci şahıs görünüm;
                game.ts: sahne/HUD/dalga akışı; hangar.ts, rules.ts, enemies.ts, arena.ts, fx.ts
  ui/           ui.ts: menüler, takma ad/oda akışı, kontrol seçimi ve HUD; touch.ts: Android kontrolleri
  i18n/         tr.json: Türkçe arayüz ve bildirimler
  styles/       main.css: HUD, mobil/masaüstü görünürlüğü ve responsive yerleşim
server/         Node.js WebSocket odaları, oda hakemi ve protokol doğrulaması
scripts/        smoke.mjs: mevcut tarayıcı smoke akışı; check-size.mjs: derleme boyut denetimi
```

## Tasarım

- **Akım:** Mat karbon ve kamera dronlarından esinlenen gerçekçi endüstriyel/saha ekipmanı; mevcut koyu askeri simülatör arayüzüyle uyumlu.
- **İlkeler:** Silah görünmeden nişangâh/telemetriye odaklan; okunabilir HUD; gerçekçi ama düşük maliyetli geometriler; PC ve Android arasında tutarlı, seçilebilir kumanda.
- **Renk:** Antrasit ve mat nötr gövde yüzeyleri; yalnızca ince turuncu ve teal durum işaretleri. Parlak/emissive yüzeyler küçük uyarı parçalarıyla sınırlı.
- **Yerleşim:** Hız, irtifa, can ve mühimmat HUD köşelerine yayılır; merkezde sade nişangâh kalır. Oda ekranı takma ad ve kısa oda kodunu öne çıkarır; dokunmatik kontroller yalnızca seçili Android kipinde gösterilir.
- **İmza öğeleri:** Katlanır kol menteşeleri ve düşük profilli kamera gimbali; ince teknik gövde çizgisi; köşeleri kesik telemetri panelleri.
- **Tipografi:** Barlow Condensed (başlık ve HUD sayıları), Barlow (gövde metni); var olan Türkçe font paketini kullan.
- **Animasyon:** Kısa, keskin arayüz geçişleri; pervane dönüşü, hafif uçuş yatışı, isabet ve düşürme efektleri. Ekstra hareketli ekran veya oyun modu ekleme.
- **Etkileşim felsefesi:** Kumanda seçimi açık ve kalıcıdır; aynı uçuş niyetleri PC klavye/fare ve Android dokunmatik yüzeylerinde karşılık bulur. HUD güvenilir durum bilgisi verir, ateş ve doldurma kısa geri bildirimle anlaşılır.
- **Brand essence:** Birinci şahıs görüşte kontrollü hava düellosu; net, çevik ve dayanıklı. Deneyim simülatör hassasiyetini arcade hızından önce tutar.
- **Brand voice:** Kısa, teknik ve sakin saha dili. Örnekler: “ŞARJÖR DOLDURULUYOR” ve “ŞARJÖR DOLDU”.
- **Wordmark & logo:** ROTOR STRIKE başlığı dar teknik harflerle; “O” içinde dört kollu rotor/kamera diyaframı, ince köşeli işaret çerçevesiyle. Mevcut oyun başlığı ve favicon bu çizgide tutarlı kalır.
- **İmza rengi:** Yanık turuncu `#ff6a2b`; atış/uyarı durumlarını vurgular, geniş yüzeylerde antrasit ve mat nötrler sakinliği korur.

## Kapsam sınırları

Tek oyunculu oyun ve AI hedefleri/dalga akışı korunur; isteğe bağlı çevrimiçi oda modu ve takma ad bu istekle eklenir. Oyun sunucusu Render üzerinde barındırılır; Cloud Computer satın alınması gerekmez. Hesap/giriş, ortak sıralama, ödeme, kalıcı çevrimiçi profil veya veritabanı eklenmez. Kullanıcının verdiği drone referans görseli yeniden açılmaz; yeni harici/ücretli 3D varlık üretimi bu değişiklik için gerekmez.
