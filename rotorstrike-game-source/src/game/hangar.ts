/**
 * Hangar kataloğu: dronlar, yükseltmeler ve bunlardan türetilen uçuş/çatışma istatistikleri.
 * Bu modül saftır (three.js yok) ve birim testleriyle doğrulanır.
 */
export type UpgradeKey = 'weapon' | 'motor' | 'hull'

export type DroneStats = {
  /** Azami hız çarpanı. */
  speed: number
  /** İvme ve dönüş çevikliği çarpanı. */
  handling: number
  /** Ateş hızı çarpanı. */
  fireRate: number
  /** Menzil çarpanı. */
  range: number
}

export type DroneSpec = {
  id: string
  name: string
  role: string
  price: number
  stats: DroneStats
  /** Gövde rengi, vurgu rengi ve cam rengi. */
  palette: { body: string; accent: string; glass: string }
  /** Prosedürel modelde kullanılan siluet ailesi. */
  frame: 'scout' | 'interceptor' | 'bastion' | 'gunship' | 'strike' | 'phantom'
}

export const DRONES: readonly DroneSpec[] = [
  {
    id: 'rq1',
    name: 'RQ-1 ARICI',
    role: 'Eğitim / denge',
    price: 0,
    stats: { speed: 1, handling: 1, fireRate: 1, range: 1 },
    palette: { body: '#6f7a80', accent: '#ff6a2b', glass: '#1d2a30' },
    frame: 'scout',
  },
  {
    id: 'sk2',
    name: 'SK-2 YILDIRIM',
    role: 'Hız avcısı',
    price: 1500,
    stats: { speed: 1.3, handling: 1.12, fireRate: 1.05, range: 0.9 },
    palette: { body: '#3c4a58', accent: '#ffd23f', glass: '#16232c' },
    frame: 'interceptor',
  },
  {
    id: 'tb3',
    name: 'TB-3 KALKAN',
    role: 'Zırhlı platform',
    price: 2800,
    stats: { speed: 0.94, handling: 0.9, fireRate: 1, range: 1.05 },
    palette: { body: '#5b6154', accent: '#3ad8c8', glass: '#182420' },
    frame: 'bastion',
  },
  {
    id: 'ac4',
    name: 'AC-4 TOPÇU',
    role: 'Ağır silah',
    price: 4200,
    stats: { speed: 0.9, handling: 0.84, fireRate: 1.45, range: 1.15 },
    palette: { body: '#4a4038', accent: '#ff8f3c', glass: '#241a14' },
    frame: 'gunship',
  },
  {
    id: 'vx5',
    name: 'VX-5 ATMACA',
    role: 'Çevik akrobat',
    price: 6000,
    stats: { speed: 1.14, handling: 1.45, fireRate: 1.2, range: 0.95 },
    palette: { body: '#2f3a44', accent: '#7ef9ff', glass: '#12222b' },
    frame: 'strike',
  },
  {
    id: 'pr6',
    name: 'PR-6 HAYALET',
    role: 'Üst seviye',
    price: 9000,
    stats: { speed: 1.24, handling: 1.3, fireRate: 1.32, range: 1.2 },
    palette: { body: '#23262c', accent: '#c9a227', glass: '#101318' },
    frame: 'phantom',
  },
]

export const UPGRADES: readonly { key: UpgradeKey; name: string; description: string; maxLevel: number; baseCost: number; step: number }[] = [
  { key: 'weapon', name: 'Silah', description: 'Daha hızlı seri atış', maxLevel: 4, baseCost: 600, step: 550 },
  { key: 'motor', name: 'Motor', description: 'Azami hız ve ivme', maxLevel: 4, baseCost: 550, step: 500 },
  { key: 'hull', name: 'Gövde', description: 'Hasarsız kalınca onarım', maxLevel: 3, baseCost: 900, step: 900 },
]

export type UpgradeLevels = Record<UpgradeKey, number>

export const DEFAULT_UPGRADES: UpgradeLevels = { weapon: 0, motor: 0, hull: 0 }

export function upgradeCost(key: UpgradeKey, level: number): number {
  const spec = UPGRADES.find(u => u.key === key)
  if (!spec || level >= spec.maxLevel) return Infinity
  return spec.baseCost + spec.step * level
}

export function droneById(id: string): DroneSpec {
  return DRONES.find(d => d.id === id) ?? DRONES[0]
}

/** Yükseltmelerin çarpanları. */
export function upgradeMultipliers(levels: UpgradeLevels) {
  return {
    fireRate: 1 + levels.weapon * 0.08,
    speed: 1 + levels.motor * 0.06,
    handling: 1 + levels.motor * 0.03,
    /** Onarım bekleme süresi (sn); 0 = onarım yok. */
    repairDelay: levels.hull === 0 ? 0 : [0, 11, 8, 6][Math.min(levels.hull, 3)],
  }
}

export type Loadout = {
  maxSpeed: number
  accel: number
  vertical: number
  fireRate: number
  range: number
  repairDelay: number
}

/** Dron + yükseltmelerden somut uçuş/silah değerleri üretir. */
export function resolveLoadout(
  drone: DroneSpec,
  levels: UpgradeLevels,
  base: { maxSpeed: number; accel: number; vertical: number; fireRate: number; range: number },
): Loadout {
  const up = upgradeMultipliers(levels)
  return {
    maxSpeed: base.maxSpeed * drone.stats.speed * up.speed,
    accel: base.accel * drone.stats.handling * up.handling,
    vertical: base.vertical * drone.stats.handling * up.handling,
    fireRate: base.fireRate * drone.stats.fireRate * up.fireRate,
    range: base.range * drone.stats.range,
    repairDelay: up.repairDelay,
  }
}

/** Katalog istatistiklerini 0..100 arası çubuk değerine çevirir (arayüz için). */
export function statBars(drone: DroneSpec): { label: string; value: number }[] {
  const pct = (v: number, min: number, max: number) => Math.round(((v - min) / (max - min)) * 100)
  return [
    { label: 'Hız', value: pct(drone.stats.speed, 0.8, 1.35) },
    { label: 'Çeviklik', value: pct(drone.stats.handling, 0.8, 1.5) },
    { label: 'Ateş', value: pct(drone.stats.fireRate, 0.9, 1.5) },
    { label: 'Menzil', value: pct(drone.stats.range, 0.85, 1.25) },
  ]
}
