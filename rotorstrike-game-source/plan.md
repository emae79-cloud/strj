# ROTOR STRIKE — Uygulama Planı

Tarayıcıda oynanan Türkçe 3D drone çatışma oyunu. Oyuncu katlanır kollu kamera dronunu birinci şahıs gimbal görünümünden uçurur; düşmanları vurup kredi kazanır, hangardan drone alır veya oda koduyla düello yapar. Her dron dört can taşır. Drone modelleri 1,2 kat büyütülür, hedef isabet yarıçapı 1,35 m, atış hızı 8,5/sn olur; 28 mermilik şarjör ve beş saniyelik dolum korunur. Harita adsız modern şehir merkezine dönüşür; açık yol koridorlarında doğan botlar daha yavaş ve daha az kaçar. Cephe/cam malzemeleri ve instanced yaya geçitleri görsel gerçekçiliği artırır. Takla kaldırılır ve pitch simetrik ±1,1 radyanla sınırlanır. Krediler, satın alınan dronlar ve seçim aynı tarayıcıda hesapsız saklanır. Deneme kipi kredi ve rekor yazmaz. Mevcut Three.js/Rapier altyapısı ve düşük cihaz desteği korunur.

## Teknik yaklaşım

- **Motor ve döngü:** Mevcut Three.js 0.186, Rapier 0.21, TypeScript ve Vite projesi korunur. Sabit 60 Hz simülasyon, tek giriş katmanı, proje Tweak yöneticisi ve sürümlü `localStorage` kaydı yeniden kullanılır.
- **Uçuş ve görüş:** İtki, atalet, sürüklenme, stabilizasyon ve çarpışma aynı fizik katmanında kalır. Fare yaw dönüşünü sürdürür; yukarı/aşağı pitch hem oyuncu hem kamera hem geri tepme için simetrik ±1,1 radyanla sınırlıdır ve taklaya izin vermez. Yanal sağ/sol itki drone gövdesini aynı yöne yatırır. Sanal çubuk ve sağ alan sürüklemesi Android'e göre çalışır. Birinci şahıs görünümünde kokpit ve görünür namlu ufku kapatmadan, alt görüşte kalır.
- **Çatışma:** Merkez nişangâhı düşman drone'un yakınına geldiğinde (yaklaşık 6° koni) hedef kilitlenir; renkli kilit çerçevesi hedefi izler, ateş basıldığında atış hedefe yumuşak biçimde yönelir. Uçuş yönü otomatik çevrilmez; kullanıcı yalnız ateş için düğmeye basar. Altı hangar drone'u ayrı silah davranışı ve WebAudio sesi taşır: dengeli makineli, hassas pulse, ağır top, otomatik top, hızlı pulse ve son drone'da hedef kilitli takip füzesı. Tracer/çarpma renkleri de türe göre ayrışır; bütün isabetler bir can düşürür. Sunucu seçilen silah türünü, drone başına atış hızını, menzili, mühimmatı ve PR-6 kilitli füzesini doğrular. Dört can/dört isabet, 8,5/sn global üst sınırı, 28 mermi ve 5 saniye dolum korunur.
- **Bot hedefleri:** Tek oyunculu botlar daha düşük hız/ivmeyle uçar, yörünge salınımı ve vurulunca kaçışı azaltılır. Botlar binaların arkasında doğmak yerine açık şehir yol koridorlarında başlar; çevrimiçi oyuncu fiziği ve atış doğrulaması değişmez.
- **Kontroller ve yatay ekran:** Ayarlarda Otomatik / PC / Android tercihi kaydedilir. Mobil sanal çubuk, nişan sürüklemesi ve ateş/yüksel/alçal düğmeleri yalnız dokunmatik kipte görünür. Yön/viewport değişiminde WebGL renderer yeniden boyutlanır; kısa yatay ekranda HUD simgeleri ve dokunmatik düğmeler güvenli alan içinde, sıkıştırılmış yerleşimde kalır.
- **Harita ve düşük donanım:** Adsız modern şehir merkezinde düzenli sokaklar, farklı yükseklikte binalar, su kanalı-köprü, küçük park ve uzaktaki şehir silueti bulunur. Yaya geçitleri tek instanced mesh ile çizilir; cephe dokusundaki cam yansımaları ve daha ölçülü emissive/PBR değerleri görünümü iyileştirir. Paylaşılan malzeme ve geometri kullanılır; yeni ağır varlık veya dinamik ışık zinciri eklenmez. İlk açılış kalite önerisi ve mevcut düşük/orta/yüksek ayarlar korunur.
- **Ses ve ilerleme:** Mevcut sentezlenmiş tuş/ateş sesleri ile sürekli döngülü müzik korunur; şarjör doldurma için kısa geri bildirim vardır. Koşu kredileri, drone satın alma, seçili drone ve yükseltmeler mevcut sürümlü `localStorage` kaydıyla aynı cihazda saklanır; hangar bunu hesap gerekmediğini belirterek açıklar. v2→v3 güvenli geçiş sürdürülür.
- **Cihaz-içi deneme kipi:** Ana menü wordmark'ına kısa aralıkta beş kez dokunma/tıklama, yalnız bu tarayıcının `localStorage` alanında kip bayrağı açar. Hangar altı drone'nun tamamını sahiplik veya satın alma gerektirmeden deneme uçuşuna açar; koşular çevrimdışıdır, online sunucuya bağlanmaz ve `bank(run)` çağrılmadığından kredi, rekor, koşu sayısı veya istatistik kaydetmez. Hangardaki kapatma düğmesi kipi kapatır. Bu cihaz-yerel bir tercih olup hesap, parola veya kimlik doğrulaması değildir.
- **Çevrimiçi oyun:** Ayrı Node.js/WebSocket hizmeti Render Web Service'te kalır; statik oyun sayfası Manus'tadır. Oda kodu, takma ad, oyuncu etiketi ve gecikmesiz yerel uçuş korunur. Sunucu oda üyeliği, 4 can, ±1,1 radyan pitch sınırı, 1,35 m hedef yarıçapı, 8,5 atış/sn, 28 mermilik şarjör, 5 saniye dolum, hasar ve düşürme sonuçlarını doğrular. Render Free uyku davranışı ve bellek içi odaların deploy/restart'ta kapanması değişmez; ücretli plan, hesap veya veritabanı eklenmez. Otomatik dağıtım mevcut ücretsiz Render hizmetinde etkin olduğundan yalnız kullanıcının seçtiği `emae79-cloud/strj` deposu güncellenir; başka depolara dokunulmaz.
- **Görsel model:** Harici model gerektirmeyen, paylaşılan geometrilerle yapılan düşük çizim yüklü prosedürel kamera drone'u kullanılır: pah kırılmış gövde, katlanma pimleri, ince kollar, motorlar, pervaneler, gimbal kamera ve görünür namlu. Altı drone varyantının biçim ve renk farklılıkları korunur. Mevcut arena, Türkçe arayüz ve oyun akışı korunur.

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
- **İlkeler:** Görünür ama ufku kapatmayan kısa namlu; okunaklı nişangâh/telemetri; gerçekçi ama düşük maliyetli geometriler; PC ve Android arasında tutarlı, seçilebilir kumanda.
- **Renk:** Antrasit ve mat nötr gövde yüzeyleri; yalnızca ince turuncu ve teal durum işaretleri. Parlak/emissive yüzeyler küçük uyarı parçalarıyla sınırlı.
- **Yerleşim:** Hız, irtifa, can ve mühimmat HUD köşelerine yayılır; merkezde sade nişangâh kalır. Oda ekranı takma ad ve kısa oda kodunu öne çıkarır; dokunmatik kontroller yalnızca seçili Android kipinde gösterilir.
- **İmza öğeleri:** Katlanır kol menteşeleri ve düşük profilli kamera gimbali; ince teknik gövde çizgisi; köşeleri kesik telemetri panelleri.
- **Tipografi:** Barlow Condensed (başlık ve HUD sayıları), Barlow (gövde metni); var olan Türkçe font paketini kullan.
- **Animasyon:** Kısa, keskin arayüz geçişleri; pervane dönüşü, daha belirgin yön-eşleşen uçuş yatışı, isabet ve düşürme efektleri. Yeni deneme kipi dışında ekstra oyun modu eklenmez.
- **Etkileşim felsefesi:** Kumanda seçimi açık ve kalıcıdır; aynı uçuş niyetleri PC klavye/fare ve Android dokunmatik yüzeylerinde karşılık bulur. Deneme koşusu ilerlemeye yazmaz; HUD yatay ekranda da okunaklı kalır.
- **Brand essence:** Birinci şahıs görüşte kontrollü hava düellosu; net, çevik ve dayanıklı. Deneyim simülatör hassasiyetini arcade hızından önce tutar.
- **Brand voice:** Kısa, teknik ve sakin saha dili. Örnekler: “ŞARJÖR DOLDURULUYOR” ve “ŞARJÖR DOLDU”.
- **Wordmark & logo:** ROTOR STRIKE başlığı dar teknik harflerle; “O” içinde dört kollu rotor/kamera diyaframı, ince köşeli işaret çerçevesiyle. Mevcut oyun başlığı ve favicon bu çizgide tutarlı kalır.
- **İmza rengi:** Yanık turuncu `#ff6a2b`; atış/uyarı durumlarını vurgular, geniş yüzeylerde antrasit ve mat nötrler sakinliği korur.

## Kapsam sınırları

Tek oyunculu oyun ve AI hedefleri/dalga akışı korunur; çevrimiçi oda modu ve takma ad mevcut kapsamda kalır. Bu güncelleme yalnız cihaz/tarayıcı yerelinde, çevrimdışı ve ilerleme kaydetmeyen tüm-drone deneme kipini ekler; hesap/kimlik güvenliği iddiası yoktur. Render ücretsiz ve otomatik dağıtım ayarı korunur; başka GitHub depolarına veya ücretli plana geçilmez. Hesap/giriş, ortak sıralama, ödeme, kalıcı çevrimiçi profil veya veritabanı eklenmez. Yeni ağır/ücretli 3D varlık üretimi gerekmez.
