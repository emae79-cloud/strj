import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Input } from '../src/engine/input'

type Handler = (event: Record<string, unknown>) => void
let listeners: Map<string, Handler[]>
let classes: Set<string>

const fire = (type: string, event: Record<string, unknown> = {}) => {
  for (const handler of listeners.get(type) ?? []) {
    handler({ code: '', repeat: false, target: null, preventDefault: () => undefined, ...event })
  }
}

const canvas = { addEventListener: () => undefined, requestPointerLock: () => undefined } as unknown as HTMLCanvasElement

beforeEach(() => {
  listeners = new Map()
  classes = new Set()
  vi.stubGlobal('window', {
    addEventListener: (type: string, handler: Handler) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler])
    },
    removeEventListener: () => undefined,
  })
  vi.stubGlobal('document', {
    pointerLockElement: null,
    exitPointerLock: () => undefined,
    body: { classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name), contains: (name: string) => classes.has(name) } },
  })
  vi.stubGlobal('navigator', { userAgent: 'Desktop', maxTouchPoints: 0, getGamepads: () => [] })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('klavye eşlemesi', () => {
  it('boşluk yükselme, shift alçalma üretir', () => {
    const input = new Input(canvas)
    fire('keydown', { code: 'Space' })
    input.update(1 / 60)
    expect(input.held('climb')).toBe(true)
    expect(input.held('descend')).toBe(false)
    fire('keyup', { code: 'Space' })
    fire('keydown', { code: 'ShiftLeft' })
    input.update(1 / 60)
    expect(input.held('climb')).toBe(false)
    expect(input.held('descend')).toBe(true)
    input.dispose()
  })

  it('W ileri itki verir, bırakınca durur', () => {
    const input = new Input(canvas)
    fire('keydown', { code: 'KeyW' })
    input.update(1 / 60)
    expect(input.move.y).toBe(1)
    fire('keyup', { code: 'KeyW' })
    input.update(1 / 60)
    expect(input.move.y).toBe(0)
    input.dispose()
  })

  it('X stabilizasyonu bir kez tetikler', () => {
    const input = new Input(canvas)
    fire('keydown', { code: 'KeyX' })
    expect(input.consume('stabilize')).toBe(true)
    expect(input.consume('stabilize')).toBe(false)
    input.endFrame()
    expect(input.consume('stabilize')).toBe(false)
    input.dispose()
  })

  it('fare ateşi yalnızca pointer lock varken basılı sayılır', () => {
    const input = new Input(canvas)
    fire('mousedown', { button: 0 })
    expect(input.held('fire')).toBe(false)
    vi.stubGlobal('document', { pointerLockElement: canvas, exitPointerLock: () => undefined })
    const locked = new Input(canvas)
    fire('mousedown', { button: 0 })
    locked.update(1 / 60)
    expect(locked.held('fire')).toBe(true)
    fire('mouseup', { button: 0 })
    locked.update(1 / 60)
    expect(locked.held('fire')).toBe(false)
    input.dispose()
    locked.dispose()
  })
})

describe('dokunmatik', () => {
  it('yüzen çubuk itki, düğmeler eylem üretir', () => {
    const input = new Input(canvas)
    input.setControlMode('android')
    input.setTouchMove(0.5, 1)
    input.setTouchButton('fire', true)
    input.update(1 / 60)
    expect(input.method).toBe('touch')
    // Çubuk vektörü birim uzunluğa normalize edilir; yön korunur.
    expect(Math.hypot(input.move.x, input.move.y)).toBeCloseTo(1)
    expect(input.move.x / input.move.y).toBeCloseTo(0.5)
    expect(input.held('fire')).toBe(true)
    input.setTouchButton('fire', false)
    input.update(1 / 60)
    expect(input.held('fire')).toBe(false)
    input.dispose()
  })

  it('PC seçimi sanal kontrolleri gizler ve dokunma girişini devre dışı bırakır', () => {
    const input = new Input(canvas)
    input.setControlMode('pc')
    input.setTouchMove(1, 0)
    input.setTouchButton('fire', true)
    input.update(1 / 60)
    expect(input.touchEnabled).toBe(false)
    expect(classes.has('show-mobile-controls')).toBe(false)
    expect(input.move.x).toBe(0)
    expect(input.held('fire')).toBe(false)
    input.dispose()
  })

  it('Android seçimi sanal kontrolleri gösterir ve Android otomatik modda algılanır', () => {
    const manual = new Input(canvas)
    manual.setControlMode('android')
    expect(manual.touchEnabled).toBe(true)
    expect(classes.has('show-mobile-controls')).toBe(true)
    manual.setControlMode('pc')
    expect(classes.has('show-mobile-controls')).toBe(false)
    manual.dispose()

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/140 Mobile', maxTouchPoints: 5, getGamepads: () => [] })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const automatic = new Input(canvas)
    expect(automatic.controlMode).toBe('auto')
    expect(automatic.touchEnabled).toBe(true)
    expect(classes.has('show-mobile-controls')).toBe(true)
    automatic.dispose()
  })
})
