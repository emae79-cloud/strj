import { describe, expect, it } from 'vitest'
import { DICTIONARY, I18n } from '../src/engine/i18n'

const i18n = new I18n()

describe('Türkçe sözlük', () => {
  it('tüm anahtarlar boş olmayan metin taşır', () => {
    for (const [key, value] of Object.entries(DICTIONARY)) {
      expect(value.trim(), key).not.toBe('')
    }
  })

  it('yer tutucuları doldurur', () => {
    expect(i18n.t('hud.wave', { n: 3 })).toBe('DALGA 3')
    expect(i18n.t('hangar.price', { n: '1.500' })).toContain('1.500')
  })

  it('eksik anahtarı görünür kılar, çökmez', () => {
    expect(i18n.t('olmayan.anahtar')).toBe('olmayan.anahtar')
  })

  it('Türkçe karakterler bozulmadan saklanır', () => {
    const text = `${DICTIONARY['settings.stabilizeHint']} ${DICTIONARY['results.title']} ${DICTIONARY['game.tagline']}`
    expect(text).toMatch(/[çğıöşüÇĞİÖŞÜ]/)
  })

  it('arayüzde kullanılan kritik anahtarlar tanımlıdır', () => {
    const required = [
      'game.title', 'menu.start', 'menu.hangar', 'menu.settings', 'menu.controls',
      'hangar.title', 'hangar.buy', 'hangar.select', 'hangar.upgrades', 'hangar.maxLevel',
      'hud.hp', 'hud.speed', 'hud.alt', 'hud.ammo', 'hud.reloading', 'hud.reloaded', 'hud.waveLabel', 'hud.credits', 'hud.score',
      'pause.title', 'pause.continue', 'pause.restart', 'pause.quit',
      'results.title', 'results.score', 'results.earned', 'results.balance', 'results.retry',
      'settings.stabilize', 'controls.fire', 'common.back',
    ]
    for (const key of required) expect(DICTIONARY[key], key).toBeTypeOf('string')
  })
})
