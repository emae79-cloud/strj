import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG } from '../src/game/config'
import { tuning } from '../src/game/tuning'

const restore = (id: string, value: number) => tuning.apply({ [id]: value })

afterEach(() => {
  for (const control of tuning.controls) restore(control.id, control.default)
})

describe('Tweak kataloğu', () => {
  it('kimlikler benzersiz ve varsayılanlar CONFIG ile aynı', () => {
    const ids = tuning.controls.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const control of tuning.controls) {
      const [section, key] = control.id.split('.') as [keyof typeof CONFIG, string]
      expect((CONFIG[section] as unknown as Record<string, number>)[key], control.id).toBe(control.default)
    }
  })

  it('canlı parametre CONFIG değerini hemen günceller', () => {
    const control = tuning.controls.find(c => c.applyMode === 'LIVE' && c.id.startsWith('weapon.'))!
    const next = control.default === control.max ? control.default - control.step : control.default + control.step
    tuning.apply({ [control.id]: next })
    const [section, key] = control.id.split('.') as [keyof typeof CONFIG, string]
    expect((CONFIG[section] as unknown as Record<string, number>)[key]).toBeCloseTo(next)
  })

  it('aralık dışı ve adım dışı değerleri reddeder', () => {
    const control = tuning.controls[0]
    expect(() => tuning.apply({ [control.id]: control.max + 100 })).toThrow()
    expect(() => tuning.apply({ [control.id]: control.min + control.step / 3 })).toThrow()
    expect(() => tuning.apply({ 'yok.parametre': 1 })).toThrow()
    expect(() => tuning.apply('bozuk')).toThrow()
  })

  it('yeni koşu parametreleri ancak activate ile uygulanır', () => {
    const control = tuning.controls.find(c => c.applyMode === 'NEXT_RUN')!
    const [section, key] = control.id.split('.') as [keyof typeof CONFIG, string]
    const values = CONFIG[section] as unknown as Record<string, number>
    const before = values[key]
    const next = before === control.max ? control.max - control.step : before + control.step
    tuning.apply({ [control.id]: next })
    expect(values[key]).toBe(before)
    tuning.activate('run')
    expect(values[key]).toBeCloseTo(next)
  })
})
