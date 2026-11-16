/**
 * Bütün oynanış ayarları tek yerde. Denge değişikliği için önce buradaki sayıları düzenle;
 * testler aynı değerleri okur.
 */
export const DEFAULT_CONFIG = {
  drone: {
    /** Her dronun canı — dört isabetli vuruşta düşer. */
    hp: 4,
    /** Çarpışma küresinin yarıçapı (m). */
    radius: 0.62,
    /** Vuruş sonrası kısa dokunulmazlık (sn) — seri ateşte anında ölmeyi önler. */
    invulnerable: 1.0,
  },
  flight: {
    /** İtki ivmesi (m/s²). */
    accel: 66,
    /** Yalnızca geri/yana itkide kullanılan daha zayıf ivme. */
    lateralAccel: 42,
    /** Dikey itki (m/s²). */
    vertical: 42,
    /** Stabilizasyon açıkken sürüklenme katsayısı (1/sn). */
    drag: 2.1,
    /** Stabilizasyon kapalıyken sürüklenme — atalet korunur. */
    driftDrag: 0.22,
    /** Yerçekimi (m/s²); stabilizasyon açıkken %25'i uygulanır. */
    gravity: -11.5,
    /** Taban azami hız (m/s); dron istatistikleriyle çarpılır. */
    maxSpeed: 52,
    /** Uçuş tavanı ve taban yüksekliği (m). */
    ceiling: 165,
    floor: 1.4,
    /** Gövdenin yatma (roll) ve burun kalkma görsel kazancı. */
    bankGain: 0.9,
    pitchGain: 0.35,
  },
  weapon: {
    /** Saniyedeki atış sayısı (dron istatistikleriyle çarpılır). */
    fireRate: 5.2,
    /** Modifikasyonlar dâhil gerçek atış hızı üst sınırı. */
    maxFireRate: 5.8,
    /** Otomatik silah şarjör kapasitesi. */
    magazineSize: 20,
    /** Şarjör boşalınca otomatik doldurma süresi (sn). */
    reloadSeconds: 5,
    /** Yayılım (radyan). */
    spread: 0.0085,
    /** Etkili menzil (m). */
    range: 300,
    /** İsabet başına hasar — dronun 4 canını 4 vuruşta bitirir. */
    damage: 1,
  },
  camera: {
    fov: 79,
    minPitch: -1.2,
    maxPitch: 1.05,
    /** Ateş geri tepmesinin bakışa etkisi (radyan). */
    recoil: 0.006,
  },
  waves: {
    /** İlk dalgadaki düşman sayısı. */
    firstCount: 2,
    /** Her dalgada eklenen düşman. */
    growth: 1,
    /** Aynı anda havada olabilecek azami düşman. */
    maxAlive: 7,
    /** Dalgalar arası hazırlık süresi (sn). */
    intermission: 6,
    /** Düşmanların doğduğu mesafe aralığı (m). */
    spawnMin: 65,
    spawnMax: 115,
  },
  economy: {
    /** İsabet başına kredi. */
    perHit: 25,
    /** Düşürme başına taban kredi (tip çarpanıyla). */
    perKill: 150,
    /** Dalga temizleme primi. */
    perWave: 220,
    /** Hayatta kalınan saniye başına kredi. */
    perSecond: 3,
  },
  ai: {
    /** Düşman ateş isabetliliğinin taban olasılığı (mesafeyle düşer). */
    accuracy: 0.3,
    /** Her dalgada isabetliliğe eklenen değer. */
    accuracyPerWave: 0.03,
    /** Azami isabetlilik. */
    accuracyMax: 0.72,
    /** Düşmanın oyuncuyu hedefleme toleransı (radyan). */
    aimTolerance: 0.16,
  },
} as const

// Oynanış her zaman buradaki etkin değerleri okur. Kaynak varsayılanlar Tweak için değişmez kalır.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
