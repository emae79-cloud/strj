import { describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import {
  DEFAULT_UPGRADES,
  DRONES,
  UPGRADES,
  droneById,
  resolveLoadout,
  statBars,
  upgradeCost,
  upgradeMultipliers,
} from '../src/game/hangar'

const base = {
  maxSpeed: CONFIG.flight.maxSpeed,
  accel: CONFIG.flight.accel,
  vertical: CONFIG.flight.vertical,
  fireRate: CONFIG.weapon.fireRate,
  range: CONFIG.weapon.range,
}

describe('dron kataloğu', () => {
  it('en az altı dron sunar, kimlikler benzersizdir', () => {
    expect(DRONES.length).toBeGreaterThanOrEqual(6)
    expect(new Set(DRONES.map(d => d.id)).size).toBe(DRONES.length)
  })

  it('ilk dron bedavadır, fiyatlar artan sırada ilerler', () => {
    expect(DRONES[0].price).toBe(0)
    const prices = DRONES.slice(1).map(d => d.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(prices.every(p => p > 0)).toBe(true)
  })

  it('bilinmeyen kimlik ilk drona düşer', () => {
    expect(droneById('yok').id).toBe(DRONES[0].id)
  })

  it('istatistik çubukları 0-100 aralığında kalır', () => {
    for (const drone of DRONES) {
      for (const bar of statBars(drone)) {
        expect(bar.value).toBeGreaterThanOrEqual(0)
        expect(bar.value).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('yükseltmeler', () => {
  it('maliyet seviyeyle artar, azami seviyede sonsuz olur', () => {
    const spec = UPGRADES[0]
    expect(upgradeCost(spec.key, 0)).toBe(spec.baseCost)
    expect(upgradeCost(spec.key, 1)).toBeGreaterThan(upgradeCost(spec.key, 0))
    expect(upgradeCost(spec.key, spec.maxLevel)).toBe(Infinity)
  })

  it('yükseltmeler hızı ve kontrollü ateş hızını artırır', () => {
    const plain = upgradeMultipliers(DEFAULT_UPGRADES)
    const maxed = upgradeMultipliers({ weapon: 4, motor: 4, hull: 3 })
    expect(maxed.fireRate).toBeGreaterThan(plain.fireRate)
    expect(maxed.speed).toBeGreaterThan(plain.speed)
    expect(plain.repairDelay).toBe(0)
    expect(maxed.repairDelay).toBeGreaterThan(0)
  })

  it('yükleme dron ve yükseltme çarpanlarını birleştirir', () => {
    const fast = droneById('sk2')
    const plain = resolveLoadout(fast, DEFAULT_UPGRADES, base)
    const tuned = resolveLoadout(fast, { ...DEFAULT_UPGRADES, motor: 2 }, base)
    expect(plain.maxSpeed).toBeCloseTo(base.maxSpeed * fast.stats.speed)
    expect(tuned.maxSpeed).toBeGreaterThan(plain.maxSpeed)
    expect(plain.fireRate).toBeCloseTo(base.fireRate * fast.stats.fireRate)
  })
})
