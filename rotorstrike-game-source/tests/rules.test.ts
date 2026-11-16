import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import {
  clearWave,
  createRun,
  damagePlayer,
  formatClock,
  registerHit,
  registerKill,
  repair,
  startWave,
  tick,
  waveEnemyCount,
} from '../src/game/rules'

describe('koşu başlangıcı', () => {
  it('her dron dört canla ve birinci dalgayla başlar', () => {
    const run = createRun()
    expect(run.hp).toBe(4)
    expect(run.maxHp).toBe(4)
    expect(run.wave).toBe(1)
    expect(run.waveTotal).toBe(CONFIG.waves.firstCount)
    expect(run.phase).toBe('playing')
  })

  it('dalga düşman sayısı büyür ve 12 ile sınırlanır', () => {
    expect(waveEnemyCount(1)).toBe(2)
    expect(waveEnemyCount(3)).toBe(4)
    expect(waveEnemyCount(50)).toBe(12)
  })
})

describe('isabet ve düşürme', () => {
  it('isabet kredi ve puan kazandırır', () => {
    const hit = registerHit(createRun())
    expect(hit.credits).toBe(CONFIG.economy.perHit)
    expect(hit.state.credits).toBe(CONFIG.economy.perHit)
    expect(hit.state.hits).toBe(1)
    expect(hit.state.score).toBeGreaterThan(0)
  })

  it('düşürme dalga ilerledikçe daha çok kredi verir', () => {
    const base = registerKill(createRun(), 100)
    const later = registerKill({ ...createRun(), wave: 5 }, 100)
    expect(later.credits).toBeGreaterThan(base.credits)
    expect(later.state.kills).toBe(1)
    expect(later.state.earned.kills).toBe(later.credits)
  })

  it('dalga tamamlanınca prim verilir ve hazırlık sayacı başlar', () => {
    const run = { ...createRun(), waveTotal: 1 }
    const result = registerKill(run, 120)
    expect(result.waveCleared).toBe(true)
    expect(result.state.wavePhase).toBe('intermission')
    expect(result.state.intermission).toBe(CONFIG.waves.intermission)
    expect(result.state.earned.waves).toBeGreaterThan(0)
  })

  it('hazırlık süresi bitince sonraki dalga başlar', () => {
    let run = clearWave({ ...createRun(), waveTotal: 1 })
    const before = run.wave
    run = tick(run, CONFIG.waves.intermission + 0.1)
    expect(run.wave).toBe(before + 1)
    expect(run.wavePhase).toBe('active')
    expect(run.waveKills).toBe(0)
    expect(startWave(run).wave).toBe(run.wave)
  })

  it('koşu bittiğinde kural işlemleri durur', () => {
    const ended = { ...createRun(), phase: 'ended' as const }
    expect(registerHit(ended).credits).toBe(0)
    expect(registerKill(ended, 100).state).toBe(ended)
  })
})

describe('hasar, onarım ve süre', () => {
  it('dört vuruş koşuyu bitirir', () => {
    let run = createRun()
    for (let i = 0; i < 3; i++) {
      const result = damagePlayer(run)
      expect(result.dead).toBe(false)
      run = result.state
    }
    const last = damagePlayer(run)
    expect(last.dead).toBe(true)
    expect(last.state.hp).toBe(0)
    expect(last.state.phase).toBe('ended')
  })

  it('onarım canı artırır ama üst sınırı aşmaz', () => {
    const hurt = { ...createRun(), hp: 2 }
    expect(repair(hurt).hp).toBe(3)
    expect(repair({ ...createRun(), hp: 4 }).hp).toBe(4)
  })

  it('hayatta kalma kredisi kesirleri biriktirir', () => {
    let run = createRun()
    for (let i = 0; i < 60; i++) run = tick(run, 1 / 6)
    expect(run.credits).toBeGreaterThanOrEqual(CONFIG.economy.perSecond)
    expect(run.earned.survival).toBe(run.credits)
  })

  it('süre biçimi dakika:saniye üretir', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(75.8)).toBe('01:15')
  })
})
