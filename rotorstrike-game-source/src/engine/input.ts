/**
 * Birleşik giriş: klavye + fare (pointer lock), gamepad ve dokunmatik tek eylem durumunu besler.
 * Oynanış `move`, `look` ve `held()/consume()` okur; ham tuşlara hiç bakmaz.
 *
 * Kenar tetiklemeli basışlar tüketildikten sonra her karede bir kez `endFrame()` çağır.
 */
import type { ControlMode } from './save'

export type Action = 'climb' | 'descend' | 'fire' | 'pause' | 'confirm' | 'back' | 'stabilize' | 'interact'
export type InputMethod = 'keyboard' | 'gamepad' | 'touch'

const KEY_BINDINGS: Record<Action, string[]> = {
  climb: ['Space'],
  descend: ['ShiftLeft', 'ShiftRight', 'ControlLeft'],
  fire: ['KeyF'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'NumpadEnter'],
  // Menüler Escape/Backspace'i DOM üzerinden kendileri işler; `back` gamepad B tuşudur.
  back: [],
  stabilize: ['KeyX'],
  interact: ['KeyE'],
}
const MOVE_KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] }
// Standart gamepad eşlemesi: A=0, B=1, X=2, Y=3, LB=4, RB=5, LT=6, RT=7, Start=9.
const PAD_BINDINGS: Record<Action, number[]> = {
  climb: [0, 4],
  descend: [1, 6],
  fire: [7, 5, 2],
  pause: [9],
  confirm: [0],
  back: [1],
  stabilize: [3],
  interact: [3],
}

export class Input {
  /** Hareket niyeti [-1, 1]: x = sağa yatay itki, y = ileri itki. */
  readonly move = { x: 0, y: 0 }
  /** Son `endFrame()`ten bu yana biriken bakış deltası (hassasiyet öncesi). */
  readonly look = { x: 0, y: 0 }
  method: InputMethod = 'keyboard'
  controlMode: ControlMode = 'auto'
  touchEnabled = false
  /** Bakış deltalarını çarpar; ayarlar ekranı yazar. */
  sensitivity = 1
  invertY = false

  private keys = new Set<string>()
  private held_ = new Set<Action>()
  private pressed_ = new Set<Action>()
  private touchMove = { x: 0, y: 0 }
  private touchButtons = new Set<Action>()
  private padPrev: boolean[] = []
  private padIndex = -1
  private padId = ''
  private mouseFire = false
  private listeners: Array<() => void> = []

  constructor(private readonly canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts)
      this.listeners.push(() => target.removeEventListener(type, fn as EventListener, opts))
    }
    on(window, 'keydown', e => {
      if (e.repeat) return
      this.keys.add(e.code)
      this.method = 'keyboard'
      for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
        if (codes.includes(e.code)) this.pressed_.add(action)
      }
      // Sayfa kaymasını engelle, ama metin alanlarında yazmayı bozma.
      const typing = (e.target as HTMLElement | null)?.matches?.('input, textarea')
      if (!typing && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault()
    })
    on(window, 'keyup', e => this.keys.delete(e.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.mouseFire = false
    })
    on(window, 'gamepaddisconnected', e => {
      if (e.gamepad.index === this.padIndex) this.resetPad()
    })
    on(window, 'mousedown', e => {
      if (document.pointerLockElement !== canvas || e.button !== 0) return
      this.method = 'keyboard'
      this.mouseFire = true
      this.pressed_.add('fire')
    })
    on(window, 'mouseup', e => {
      if (e.button === 0) this.mouseFire = false
    })
    on(window, 'mousemove', e => {
      if (this.touchEnabled || document.pointerLockElement !== canvas) return
      this.look.x += e.movementX * 0.0022
      this.look.y += e.movementY * 0.0022
    })
    this.setControlMode('auto')
  }

  /** PC/Android/otomatik seçimi, sanal düğmelerin görünürlüğü ve girişlerini birlikte yönetir. */
  setControlMode(mode: ControlMode): void {
    const wasTouchEnabled = this.touchEnabled
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent ?? ''
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    const hasTouch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 0
    this.controlMode = mode
    this.touchEnabled = mode === 'android' || (mode === 'auto' && /Android/i.test(userAgent) && (coarse || hasTouch))
    if (typeof document !== 'undefined') document.body?.classList?.toggle('show-mobile-controls', this.touchEnabled)
    if (this.touchEnabled) {
      if (!wasTouchEnabled) this.method = 'touch'
      this.unlockPointer()
    } else {
      this.touchMove.x = 0
      this.touchMove.y = 0
      this.touchButtons.clear()
      if (this.method === 'touch') this.method = 'keyboard'
    }
  }

  /** Fare bakışı için pointer lock iste (kullanıcı hareketinden çağrılmalı). */
  lockPointer(): void {
    if (!this.touchEnabled && document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock?.()?.catch?.(() => undefined)
    }
  }

  unlockPointer(): void {
    this.mouseFire = false
    if (document.pointerLockElement) document.exitPointerLock()
  }

  /** Dokunmatik kontroller buradan beslenir. */
  setTouchMove(x: number, y: number): void {
    if (!this.touchEnabled) return
    this.method = 'touch'
    this.touchMove.x = x
    this.touchMove.y = y
  }

  addTouchLook(dx: number, dy: number): void {
    if (!this.touchEnabled) return
    this.method = 'touch'
    this.look.x += dx * 0.0038
    this.look.y += dy * 0.0038
  }

  setTouchButton(action: Action, down: boolean): void {
    if (!this.touchEnabled) return
    this.method = 'touch'
    if (down && !this.touchButtons.has(action)) this.pressed_.add(action)
    if (down) this.touchButtons.add(action)
    else this.touchButtons.delete(action)
  }

  private resetPad(): void {
    this.padPrev = []
    this.padIndex = -1
    this.padId = ''
  }

  /** Kare başına bir kez örnekle; sürekli çubuk bakışı geçen süreyle ölçeklenir. */
  update(frameSeconds = 1 / 60): void {
    const k = (codes: string[]) => codes.some(code => this.keys.has(code))
    let x = (k(MOVE_KEYS.right) ? 1 : 0) - (k(MOVE_KEYS.left) ? 1 : 0)
    let y = (k(MOVE_KEYS.up) ? 1 : 0) - (k(MOVE_KEYS.down) ? 1 : 0)
    this.held_.clear()
    for (const [action, codes] of Object.entries(KEY_BINDINGS) as [Action, string[]][]) {
      if (k(codes)) this.held_.add(action)
    }
    if (this.mouseFire) this.held_.add('fire')
    for (const action of this.touchButtons) this.held_.add(action)
    if (this.touchMove.x !== 0 || this.touchMove.y !== 0) {
      x = this.touchMove.x
      y = this.touchMove.y
    }
    const pad = navigator.getGamepads?.().find(p => p && p.connected)
    if (pad) {
      if (pad.index !== this.padIndex || pad.id !== this.padId) this.padPrev = []
      this.padIndex = pad.index
      this.padId = pad.id
      const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v)
      const lx = dead(pad.axes[0] ?? 0)
      const ly = dead(pad.axes[1] ?? 0)
      const rx = dead(pad.axes[2] ?? 0)
      const ry = dead(pad.axes[3] ?? 0)
      const padActive = lx !== 0 || ly !== 0 || rx !== 0 || ry !== 0 || pad.buttons.some(b => b.pressed)
      if (padActive) this.method = 'gamepad'
      const dx = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0)
      const dy = (pad.buttons[12]?.pressed ? 1 : 0) - (pad.buttons[13]?.pressed ? 1 : 0)
      if (lx !== 0 || ly !== 0 || dx !== 0 || dy !== 0) {
        x = dx || lx
        y = dy || -ly
      }
      // 60 Hz dönüş hızını her yenileme frekansında koru.
      this.look.x += rx * 2.4 * frameSeconds
      this.look.y += ry * 2.4 * frameSeconds
      for (const [action, buttons] of Object.entries(PAD_BINDINGS) as [Action, number[]][]) {
        if (buttons.some(i => pad.buttons[i]?.pressed)) this.held_.add(action)
        if (buttons.some(i => pad.buttons[i]?.pressed && !this.padPrev[i])) this.pressed_.add(action)
      }
      this.padPrev = pad.buttons.map(b => b.pressed)
    } else this.resetPad()
    const len = Math.hypot(x, y)
    this.move.x = len > 1 ? x / len : x
    this.move.y = len > 1 ? y / len : y
  }

  held(action: Action): boolean {
    return this.held_.has(action)
  }

  /** Fiziksel basış başına bir kez doğru. */
  pressed(action: Action): boolean {
    return this.pressed_.has(action)
  }

  /**
   * Basışı oku ve temizle. Sabit simülasyon adımlarında kullan: tek karede birden çok adım
   * çalışabilir ve bir basış yalnızca bir kez tetiklenmelidir.
   */
  consume(action: Action): boolean {
    return this.pressed_.delete(action)
  }

  /** Bakış deltasını hassasiyet/ters çevirme uygulanmış olarak tüket. */
  takeLook(): { x: number; y: number } {
    const out = { x: this.look.x * this.sensitivity, y: this.look.y * this.sensitivity * (this.invertY ? -1 : 1) }
    this.look.x = 0
    this.look.y = 0
    return out
  }

  endFrame(): void {
    this.pressed_.clear()
  }

  dispose(): void {
    for (const off of this.listeners) off()
    this.listeners = []
  }
}
