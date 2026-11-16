/**
 * Sürümlemeli yerel kayıt. Oyuncunun oturumlar arası taşıdığı her şey tek JSON kaydında
 * tutulur; bozuk ya da yabancı veri varsayılanlara düşer, oyunu kilitlemez.
 */
import { DEFAULT_UPGRADES, DRONES, UPGRADES, type UpgradeKey, type UpgradeLevels } from '../game/hangar'

export type Quality = 'low' | 'medium' | 'high'
export type ControlMode = 'auto' | 'pc' | 'android'

export type SaveData = {
  version: 3
  credits: number
  owned: string[]
  selected: string
  upgrades: UpgradeLevels
  best: { score: number; wave: number; kills: number }
  totals: { runs: number; kills: number; deaths: number; earned: number }
  musicVolume: number
  sfxVolume: number
  muted: boolean
  sensitivity: number
  invertY: boolean
  quality: Quality
  controlMode: ControlMode
  reducedMotion: boolean
  /** Uçuş stabilizasyon yardımı (yeni oyuncular için açık). */
  stabilize: boolean
  tutorialDone: boolean
  nickname: string
}

export const SAVE_KEY = 'rotorstrike.save'
const STARTING_DRONE = DRONES[0].id

export function defaultSave(): SaveData {
  return {
    version: 3,
    credits: 0,
    owned: [STARTING_DRONE],
    selected: STARTING_DRONE,
    upgrades: { ...DEFAULT_UPGRADES },
    best: { score: 0, wave: 0, kills: 0 },
    totals: { runs: 0, kills: 0, deaths: 0, earned: 0 },
    musicVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    sensitivity: 1,
    invertY: false,
    quality: 'high',
    controlMode: 'auto',
    reducedMotion: false,
    stabilize: true,
    tutorialDone: false,
    nickname: '',
  }
}

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const int = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : fallback)

/** Güvenilmeyen kayıtlı JSON'u geçerli SaveData'ya çevirir (saf; birim testli). */
export function parseSave(raw: string | null): SaveData {
  const base = defaultSave()
  if (!raw) return base
  let data: Record<string, unknown>
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base
    data = parsed as Record<string, unknown>
  } catch {
    return base
  }
  if (data.version !== 2 && data.version !== 3) return base

  const known = new Set(DRONES.map(d => d.id))
  const owned = Array.isArray(data.owned) ? data.owned.filter((id): id is string => typeof id === 'string' && known.has(id)) : []
  if (!owned.includes(STARTING_DRONE)) owned.unshift(STARTING_DRONE)
  const selected = typeof data.selected === 'string' && owned.includes(data.selected) ? data.selected : STARTING_DRONE

  const rawUpgrades = (data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {}) as Record<string, unknown>
  const upgrades = { ...DEFAULT_UPGRADES }
  for (const spec of UPGRADES) {
    const key = spec.key as UpgradeKey
    upgrades[key] = Math.min(spec.maxLevel, int(rawUpgrades[key], 0))
  }

  const rawBest = (data.best && typeof data.best === 'object' ? data.best : {}) as Record<string, unknown>
  const rawTotals = (data.totals && typeof data.totals === 'object' ? data.totals : {}) as Record<string, unknown>

  return {
    version: 3,
    credits: int(data.credits, 0),
    owned,
    selected,
    upgrades,
    best: { score: int(rawBest.score, 0), wave: int(rawBest.wave, 0), kills: int(rawBest.kills, 0) },
    totals: {
      runs: int(rawTotals.runs, 0),
      kills: int(rawTotals.kills, 0),
      deaths: int(rawTotals.deaths, 0),
      earned: int(rawTotals.earned, 0),
    },
    musicVolume: clamp(data.musicVolume, 0, 1, base.musicVolume),
    sfxVolume: clamp(data.sfxVolume, 0, 1, base.sfxVolume),
    muted: data.muted === true,
    sensitivity: clamp(data.sensitivity, 0.2, 3, base.sensitivity),
    invertY: data.invertY === true,
    quality: data.quality === 'low' || data.quality === 'medium' || data.quality === 'high' ? data.quality : base.quality,
    controlMode: data.controlMode === 'pc' || data.controlMode === 'android' ? data.controlMode : 'auto',
    reducedMotion: data.reducedMotion === true,
    stabilize: data.stabilize !== false,
    tutorialDone: data.tutorialDone === true,
    nickname: typeof data.nickname === 'string' ? data.nickname.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18) : '',
  }
}

export class SaveStore {
  data: SaveData

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = globalThis.localStorage) {
    let raw: string | null = null
    try {
      raw = this.storage?.getItem(SAVE_KEY) ?? null
    } catch {
      raw = null
    }
    this.data = parseSave(raw)
  }

  update(patch: Partial<SaveData>): void {
    this.data = { ...this.data, ...patch }
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch {
      // Gizli sekme veya kota: oyun bellek içi ayarlarla çalışmaya devam eder.
    }
  }
}
