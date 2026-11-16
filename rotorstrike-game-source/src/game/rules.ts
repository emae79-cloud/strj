import { CONFIG } from './config'

/**
 * Saf koşu kuralları: can, dalga akışı, skor ve kredi. three.js, Rapier ve DOM yok —
 * sahne olayları bildirir, buradan durumu okur; birim testleri her kuralı kapsar.
 */
export type RunPhase = 'playing' | 'ended'
export type WavePhase = 'active' | 'intermission'

export type RunState = {
  phase: RunPhase
  hp: number
  maxHp: number
  wave: number
  wavePhase: WavePhase
  /** Hazırlık geri sayımı (sn). */
  intermission: number
  /** Dalgada düşürülmesi gereken toplam düşman. */
  waveTotal: number
  /** Bu dalgada düşürülen düşman. */
  waveKills: number
  score: number
  credits: number
  hits: number
  kills: number
  elapsed: number
  /** Hayatta kalma kredisinin küsurat biriktiricisi. */
  survivalCarry: number
  /** Sonuç ekranı için ayrıştırılmış kazançlar. */
  earned: { hits: number; kills: number; waves: number; survival: number }
}

export function createRun(rules = CONFIG): RunState {
  return {
    phase: 'playing',
    hp: rules.drone.hp,
    maxHp: rules.drone.hp,
    wave: 1,
    wavePhase: 'active',
    intermission: 0,
    waveTotal: rules.waves.firstCount,
    waveKills: 0,
    score: 0,
    credits: 0,
    hits: 0,
    kills: 0,
    elapsed: 0,
    survivalCarry: 0,
    earned: { hits: 0, kills: 0, waves: 0, survival: 0 },
  }
}

/** Dalga numarasına göre düşman sayısı. */
export function waveEnemyCount(wave: number, rules = CONFIG): number {
  return Math.min(12, rules.waves.firstCount + (wave - 1) * rules.waves.growth)
}

export function tick(s: RunState, dt: number, rules = CONFIG): RunState {
  if (s.phase !== 'playing') return s
  let next: RunState = { ...s, elapsed: s.elapsed + dt }
  if (next.wavePhase === 'intermission') {
    const intermission = Math.max(0, next.intermission - dt)
    next = { ...next, intermission }
    if (intermission <= 0) next = startWave(next, rules)
  }
  // Hayatta kalma kredisi: saniyede `perSecond`, küsurat biriktirilerek.
  const carry = next.survivalCarry + rules.economy.perSecond * dt
  const whole = Math.floor(carry)
  if (whole > 0) {
    next = {
      ...next,
      survivalCarry: carry - whole,
      credits: next.credits + whole,
      earned: { ...next.earned, survival: next.earned.survival + whole },
    }
  } else if (carry !== next.survivalCarry) {
    next = { ...next, survivalCarry: carry }
  }
  return next
}

/** Oyuncunun isabetli atışı. */
export function registerHit(s: RunState, rules = CONFIG): { state: RunState; credits: number } {
  if (s.phase !== 'playing') return { state: s, credits: 0 }
  const credits = rules.economy.perHit
  return {
    state: {
      ...s,
      hits: s.hits + 1,
      score: s.score + 50,
      credits: s.credits + credits,
      earned: { ...s.earned, hits: s.earned.hits + credits },
    },
    credits,
  }
}

/** Düşman düşürüldü. `value` tipin taban kredisidir. */
export function registerKill(s: RunState, value: number, rules = CONFIG): { state: RunState; credits: number; waveCleared: boolean } {
  if (s.phase !== 'playing') return { state: s, credits: 0, waveCleared: false }
  const credits = Math.round(value * (1 + (s.wave - 1) * 0.08))
  const waveKills = s.waveKills + 1
  let next: RunState = {
    ...s,
    kills: s.kills + 1,
    waveKills,
    score: s.score + 250,
    credits: s.credits + credits,
    earned: { ...s.earned, kills: s.earned.kills + credits },
  }
  const cleared = waveKills >= s.waveTotal
  if (cleared) next = clearWave(next, rules)
  return { state: next, credits, waveCleared: cleared }
}

/** Dalga tamamlandı: prim + hazırlık sayacı. */
export function clearWave(s: RunState, rules = CONFIG): RunState {
  const bonus = Math.round(rules.economy.perWave * (1 + (s.wave - 1) * 0.25))
  return {
    ...s,
    wavePhase: 'intermission',
    intermission: rules.waves.intermission,
    score: s.score + 500 * s.wave,
    credits: s.credits + bonus,
    earned: { ...s.earned, waves: s.earned.waves + bonus },
  }
}

export function startWave(s: RunState, rules = CONFIG): RunState {
  const wave = s.wavePhase === 'intermission' ? s.wave + 1 : s.wave
  return {
    ...s,
    wave,
    wavePhase: 'active',
    intermission: 0,
    waveTotal: waveEnemyCount(wave, rules),
    waveKills: 0,
  }
}

/** Oyuncu vuruldu. Can biterse koşu sonlanır. */
export function damagePlayer(s: RunState, rules = CONFIG): { state: RunState; dead: boolean } {
  void rules
  if (s.phase !== 'playing') return { state: s, dead: false }
  const hp = Math.max(0, s.hp - 1)
  if (hp <= 0) return { state: { ...s, hp: 0, phase: 'ended' }, dead: true }
  return { state: { ...s, hp }, dead: false }
}

/** Onarım: canı bir artırır (üst sınır maxHp). */
export function repair(s: RunState): RunState {
  if (s.phase !== 'playing' || s.hp >= s.maxHp) return s
  return { ...s, hp: Math.min(s.maxHp, s.hp + 1) }
}

export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}
