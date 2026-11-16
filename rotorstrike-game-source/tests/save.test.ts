import { describe, expect, it } from 'vitest'
import { SAVE_KEY, SaveStore, defaultSave, parseSave } from '../src/engine/save'
import { DRONES } from '../src/game/hangar'

const store = (initial: Record<string, string> = {}) => {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  }
}

describe('kayıt ayrıştırma', () => {
  it('boş kayıtta varsayılanları verir ve ilk dronu açar', () => {
    const data = parseSave(null)
    expect(data.version).toBe(3)
    expect(data.credits).toBe(0)
    expect(data.owned).toEqual([DRONES[0].id])
    expect(data.selected).toBe(DRONES[0].id)
    expect(data.controlMode).toBe('auto')
    expect(data.stabilize).toBe(true)
  })

  it('bozuk JSON ve yabancı sürüm varsayılana döner', () => {
    expect(parseSave('{bozuk')).toEqual(defaultSave())
    expect(parseSave(JSON.stringify({ version: 1, credits: 999 }))).toEqual(defaultSave())
  })

  it('sahip olunmayan dronu seçtirmez ve bilinmeyen kimlikleri atar', () => {
    const data = parseSave(JSON.stringify({ version: 2, owned: ['sk2', 'yok'], selected: 'pr6' }))
    expect(data.owned).toEqual([DRONES[0].id, 'sk2'])
    expect(data.selected).toBe(DRONES[0].id)
    expect(data.version).toBe(3)
  })

  it('kredileri ve yükseltmeleri sınırlar', () => {
    const data = parseSave(JSON.stringify({ version: 2, credits: -50, upgrades: { weapon: 99, hull: 1.7 } }))
    expect(data.credits).toBe(0)
    expect(data.upgrades.weapon).toBe(4)
    expect(data.upgrades.hull).toBe(1)
    expect(data.upgrades.motor).toBe(0)
  })

  it('ayar aralıklarını kısıtlar', () => {
    const data = parseSave(JSON.stringify({ version: 2, musicVolume: 5, sensitivity: 0.01, quality: 'ultra' }))
    expect(data.musicVolume).toBe(1)
    expect(data.sensitivity).toBe(0.2)
    expect(data.quality).toBe('high')
  })
})

describe('kalıcılık', () => {
  it('güncellemeyi yazar ve yeniden okur', () => {
    const storage = store()
    const save = new SaveStore(storage)
    save.update({ credits: 1234, owned: [DRONES[0].id, 'sk2'], selected: 'sk2', controlMode: 'android' })
    expect(storage.map.has(SAVE_KEY)).toBe(true)
    const reloaded = new SaveStore(storage)
    expect(reloaded.data.credits).toBe(1234)
    expect(reloaded.data.selected).toBe('sk2')
    expect(reloaded.data.controlMode).toBe('android')
  })

  it('depolama hata verse de bellekte çalışır', () => {
    const failing = {
      getItem: () => {
        throw new Error('gizli sekme')
      },
      setItem: () => {
        throw new Error('kota')
      },
    }
    const save = new SaveStore(failing)
    expect(() => save.update({ credits: 10 })).not.toThrow()
    expect(save.data.credits).toBe(10)
  })
})
