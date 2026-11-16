import type { Audio } from '../engine/audio'
import type { I18n } from '../engine/i18n'
import type { Input } from '../engine/input'
import type { ControlMode, Quality, SaveData, SaveStore } from '../engine/save'
import type { HudState } from '../game/game'
import { DRONES, UPGRADES, droneById, statBars, upgradeCost, type UpgradeKey } from '../game/hangar'
import { formatClock } from '../game/rules'

export type Screen = 'boot' | 'title' | 'online' | 'hangar' | 'settings' | 'controls' | 'hud' | 'pause' | 'results'

export type UiActions = {
  play(): void
  resume(): void
  restart(): void
  quit(): void
  settings(patch: Partial<SaveData>): void
  buy(id: string): void
  select(id: string): void
  upgrade(key: UpgradeKey): void
  stabilize(on: boolean): void
  onlineCreate(nickname: string): void
  onlineJoin(nickname: string, room: string): void
  onlineCancel(): void
}

const ICON = {
  drone: '<svg viewBox="0 0 48 32" aria-hidden="true"><rect x="14" y="12" width="20" height="8" rx="3" fill="currentColor"/><path d="M6 8h6l6 6-4 4-6-6zM42 8h-6l-6 6 4 4 6-6zM6 24h6l6-6-4-4-6 6zM42 24h-6l-6-6 4-4 6 6z" fill="currentColor" opacity=".75"/><circle cx="6" cy="8" r="3" fill="currentColor"/><circle cx="42" cy="8" r="3" fill="currentColor"/><circle cx="6" cy="24" r="3" fill="currentColor"/><circle cx="42" cy="24" r="3" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.5" fill="currentColor"/></svg>',
  crosshair: '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="17" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55"/><path d="M32 4v14M32 46v14M4 32h14M46 32h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="32" r="1.8" fill="currentColor"/></svg>',
}

/**
 * DOM arayüzü: yükleme, ana menü, hangar, ayarlar, kontroller, HUD, duraklatma ve sonuç
 * ekranları. Bütün metinler Türkçe sözlükten gelir; her ekran klavye ve gamepad ile gezilebilir.
 */
export class Ui {
  screen: Screen = 'boot'
  private readonly root: HTMLElement
  private readonly stack: Screen[] = []
  private hudCache = new Map<string, string>()
  private navRepeat = 0
  private lastMethod = ''
  private hintText: string | null = null
  private selectedDrone = ''
  private lastRun: import('../game/rules').RunState | null = null

  constructor(
    private readonly i18n: I18n,
    private readonly save: SaveStore,
    private readonly audio: Audio,
    private readonly input: Input,
    private readonly actions: UiActions,
  ) {
    this.root = document.getElementById('ui')!
    this.root.innerHTML = this.template()
    this.root.addEventListener('click', e => this.onClick(e))
    this.root.addEventListener('input', e => this.onInput(e))
    this.root.addEventListener('focusin', e => {
      if ((e.target as HTMLElement).matches('.btn, .seg button, .toggle, .card-btn')) this.audio.play('ui')
    })
    window.addEventListener('keydown', e => this.onKey(e))
    this.translate()
    this.refreshSettings()
    this.renderTitle()
    this.selectedDrone = this.save.data.selected
    this.renderHangar()
  }

  // ─── ekranlar ─────────────────────────────────────────────────────────────

  show(screen: Screen): void {
    this.stack.length = 0
    this.setScreen(screen)
  }

  push(screen: Screen): void {
    this.stack.push(this.screen)
    this.setScreen(screen)
  }

  back(): void {
    if (this.screen === 'online') this.actions.onlineCancel()
    const prev = this.stack.pop()
    if (prev) this.setScreen(prev)
    else if (this.screen === 'pause') this.actions.resume()
  }

  private setScreen(screen: Screen): void {
    this.screen = screen
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-screen]')) {
      const active = el.dataset.screen === screen || (el.dataset.screen === 'hud' && (screen === 'pause' || screen === 'results'))
      el.classList.toggle('is-active', active)
      el.setAttribute('aria-hidden', String(!active))
    }
    this.root.dataset.activeScreen = screen
    if (screen === 'title') this.renderTitle()
    if (screen === 'hangar') this.renderHangar()
    if (screen === 'settings') this.refreshSettings()
    requestAnimationFrame(() => {
      const first = this.navItems()[0]
      if (first && this.input.method !== 'touch') first.focus({ preventScroll: true })
      else (document.activeElement as HTMLElement | null)?.blur?.()
    })
  }

  setBootProgress(progress: number): void {
    const bar = this.root.querySelector<HTMLElement>('.boot-bar i')
    if (bar) bar.style.transform = `scaleX(${Math.max(0.04, Math.min(1, progress))})`
  }

  /** HUD'da gösterilecek aktif dronun adı. */
  setDrone(name: string): void {
    this.text('.js-hud-drone', name)
  }

  onlineStatus(state: string, detail?: string): void {
    const text = this.i18n.t(`online.status.${state}`)
    this.text('.online-status', detail === 'not_configured' ? `${text} — Render sunucusunu bağlayıp adresini ekle.` : detail === 'invalid_nickname' ? 'Takma ad gir ve 6 karakterli oda kodunu kontrol et.' : text)
  }

  setOnlineRoomCode(code: string): void {
    const field = this.root.querySelector<HTMLInputElement>('[name="room"]')
    if (field) field.value = code
  }

  onlineRoom(code: string, count: number): void {
    this.text('.hud-online-room', this.i18n.t('online.roomLabel', { code, count }))
  }

  // ─── HUD ──────────────────────────────────────────────────────────────────

  updateHud(s: HudState): void {
    const cells = this.root.querySelector('.hud-hp-cells')!
    if (cells.childElementCount !== s.maxHp) {
      cells.innerHTML = '<span class="hp-cell"></span>'.repeat(s.maxHp)
    }
    for (const [i, cell] of [...cells.children].entries()) cell.classList.toggle('is-empty', i >= s.hp)

    this.set('wave', String(s.wave))
    this.set('speed', String(Math.round(s.speed * 3.6)))
    this.set('alt', String(Math.round(s.altitude)))
    this.set('credits', s.credits.toLocaleString('tr-TR'))
    this.set('score', s.score.toLocaleString('tr-TR'))
    this.set('targets', s.wavePhase === 'intermission' ? `${Math.ceil(s.intermission)} SN` : `${s.enemiesLeft} HEDEF`)

    const ammoWrap = this.root.querySelector('.hud-ammo')!
    const reloading = s.reloadRemaining > 0
    ammoWrap.classList.toggle('is-reloading', reloading)
    this.set('ammo', `${s.ammo} / ${s.magazineSize}`)
    this.set('reload', reloading ? `${this.i18n.t('hud.reloading')} ${s.reloadRemaining.toFixed(1)}s` : '')
    const reloadFill = this.root.querySelector<HTMLElement>('.hud-reload-fill')!
    reloadFill.style.transform = `scaleX(${reloading ? Math.max(0, 1 - s.reloadRemaining / s.reloadDuration) : 0})`

    const repair = this.root.querySelector<HTMLElement>('.hud-repair')!
    const showRepair = s.repairIn > 0
    repair.classList.toggle('is-active', showRepair)
    if (showRepair) this.set('repair', `${s.repairIn.toFixed(0)}s`)
  }

  popup(text: string, at: { x: number; y: number }, kind: 'score' | 'hurt' | 'kill'): void {
    const el = document.createElement('div')
    el.className = `popup popup-${kind}`
    el.textContent = text
    el.style.left = `${at.x}px`
    el.style.top = `${at.y}px`
    this.root.querySelector('.popups')!.append(el)
    el.addEventListener('animationend', () => el.remove())
  }

  hurt(): void {
    const v = this.root.querySelector('.hurt-vignette')!
    v.classList.remove('flash')
    void (v as HTMLElement).offsetWidth
    v.classList.add('flash')
  }

  kill(text: string): void {
    const feed = this.root.querySelector('.killfeed')!
    const item = document.createElement('div')
    item.className = 'kill-item'
    item.textContent = text
    feed.prepend(item)
    while (feed.childElementCount > 4) feed.lastElementChild?.remove()
    window.setTimeout(() => item.classList.add('is-out'), 2600)
    window.setTimeout(() => item.remove(), 3400)
  }

  hint(text: string | null): void {
    this.hintText = text
    const el = this.root.querySelector('.hint')!
    if (!text) {
      el.classList.remove('is-active')
      return
    }
    el.querySelector('span')!.textContent = text
    el.classList.add('is-active')
  }

  banner(text: string): void {
    const el = this.root.querySelector('.banner')!
    el.textContent = text
    el.classList.remove('show')
    void (el as HTMLElement).offsetWidth
    el.classList.add('show')
  }

  // ─── ana menü / hangar ────────────────────────────────────────────────────

  renderTitle(): void {
    const d = this.save.data
    this.text('.js-credits', d.credits.toLocaleString('tr-TR'))
    this.text('.js-drone', droneById(d.selected).name)
    this.text('.js-best', d.best.score > 0 ? `${d.best.score.toLocaleString('tr-TR')} · ${this.i18n.t('title.wave', { n: d.best.wave })}` : '—')
    this.text('.js-kills', d.totals.kills.toLocaleString('tr-TR'))
  }

  renderHangar(): void {
    const d = this.save.data
    this.text('.js-wallet', d.credits.toLocaleString('tr-TR'))
    const list = this.root.querySelector('.js-drone-list')!
    list.innerHTML = DRONES.map(spec => {
      const owned = d.owned.includes(spec.id)
      const selected = d.selected === spec.id
      const active = this.selectedDrone === spec.id
      return `<button class="drone-card${active ? ' is-active' : ''}${owned ? '' : ' is-locked'}" data-action="inspect" data-drone="${spec.id}" data-nav>
        <span class="drone-card-name">${spec.name}</span>
        <span class="drone-card-role">${spec.role}</span>
        <span class="drone-card-state">${selected ? this.i18n.t('hangar.selected') : owned ? this.i18n.t('hangar.owned') : this.i18n.t('hangar.price', { n: spec.price.toLocaleString('tr-TR') })}</span>
      </button>`
    }).join('')
    this.renderDroneDetail()
  }

  private renderDroneDetail(): void {
    const d = this.save.data
    const spec = droneById(this.selectedDrone)
    const owned = d.owned.includes(spec.id)
    const selected = d.selected === spec.id
    const panel = this.root.querySelector('.js-drone-detail')!
    const bars = statBars(spec)
      .map(b => `<div class="stat"><span>${b.label}</span><i><b style="width:${Math.max(6, Math.min(100, b.value))}%"></b></i></div>`)
      .join('')
    const upgrades = UPGRADES.map(u => {
      const level = d.upgrades[u.key]
      const maxed = level >= u.maxLevel
      const cost = upgradeCost(u.key, level)
      const affordable = d.credits >= cost
      return `<div class="upgrade">
        <div class="upgrade-head"><b>${u.name}</b><span>${maxed ? this.i18n.t('hangar.maxLevel') : `${level}/${u.maxLevel}`}</span></div>
        <p>${u.description}</p>
        <div class="pips">${Array.from({ length: u.maxLevel }, (_, i) => `<i class="${i < level ? 'is-on' : ''}"></i>`).join('')}</div>
        <button class="card-btn" data-action="upgrade" data-upgrade="${u.key}" data-nav ${maxed || !affordable ? 'disabled' : ''}>
          ${maxed ? this.i18n.t('hangar.maxLevel') : `${cost.toLocaleString('tr-TR')} KR`}
        </button>
      </div>`
    }).join('')

    panel.innerHTML = `
      <div class="detail-head">
        <h3>${spec.name}</h3>
        <span>${spec.role}</span>
      </div>
      <div class="detail-bars">${bars}</div>
      <div class="detail-hull"><span>${this.i18n.t('hangar.hullNote')}</span><b>${
        d.upgrades.hull === 0
          ? this.i18n.t('hangar.repairNone')
          : this.i18n.t('hangar.repair', { n: [0, 11, 8, 6][Math.min(d.upgrades.hull, 3)] })
      }</b></div>
      <div class="detail-actions">
        ${owned
          ? selected
            ? `<div class="detail-chip">${this.i18n.t('hangar.selected')}</div>`
            : `<button class="btn btn-primary" data-action="select" data-drone="${spec.id}" data-nav><span>${this.i18n.t('hangar.select')}</span></button>`
          : `<button class="btn btn-primary" data-action="buy" data-drone="${spec.id}" data-nav ${d.credits < spec.price ? 'disabled' : ''}><span>${this.i18n.t('hangar.buy')} · ${spec.price.toLocaleString('tr-TR')} KR</span></button>`}
      </div>
      <h4>${this.i18n.t('hangar.upgrades')}</h4>
      <div class="upgrade-grid">${upgrades}</div>`
    this.translate(panel)
  }

  // ─── ayarlar ──────────────────────────────────────────────────────────────

  refreshSettings(): void {
    const d = this.save.data
    this.value('[name="musicVolume"]', d.musicVolume)
    this.value('[name="sfxVolume"]', d.sfxVolume)
    this.value('[name="sensitivity"]', d.sensitivity)
    for (const t of this.root.querySelectorAll<HTMLButtonElement>('.toggle')) {
      const key = t.dataset.setting as 'muted' | 'invertY' | 'reducedMotion' | 'stabilize'
      const on = d[key] === true
      t.setAttribute('aria-pressed', String(on))
      const label = t.querySelector('span')
      if (label) label.textContent = this.i18n.t(on ? 'settings.on' : 'settings.off')
    }
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.seg button')) {
      const key = b.parentElement!.dataset.setting
      if (key === 'quality') b.setAttribute('aria-pressed', String(b.dataset.value === d.quality))
      if (key === 'controlMode') b.setAttribute('aria-pressed', String(b.dataset.value === d.controlMode))
    }
    for (const r of this.root.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      r.style.setProperty('--fill', `${((Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min))) * 100}%`)
    }
  }

  // ─── sonuçlar ─────────────────────────────────────────────────────────────

  showResults(run: import('../game/rules').RunState): void {
    this.lastRun = run
    const fmt = (v: number) => v.toLocaleString('tr-TR')
    this.text('.r-wave', String(run.wave))
    this.text('.r-kills', String(run.kills))
    this.text('.r-hits', String(run.hits))
    this.text('.r-score', run.score.toLocaleString('tr-TR'))
    this.text('.r-time', formatClock(run.elapsed))
    this.text('.r-earn-hits', fmt(run.earned.hits))
    this.text('.r-earn-kills', fmt(run.earned.kills))
    this.text('.r-earn-waves', fmt(run.earned.waves))
    this.text('.r-earn-survival', fmt(run.earned.survival))
    this.text('.r-earned', fmt(run.credits))
    this.text('.r-balance', fmt(this.save.data.credits))
    const best = run.score >= this.save.data.best.score && run.score > 0
    this.root.querySelector('.results-best')!.classList.toggle('is-active', best)
    this.show('results')
  }

  // ─── olaylar ──────────────────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], .toggle, .seg button')
    if (!target) return
    this.audio.unlock()
    if (target.matches('.toggle')) {
      const key = target.dataset.setting as 'muted' | 'invertY' | 'reducedMotion' | 'stabilize'
      this.actions.settings({ [key]: !this.save.data[key] })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    if (target.matches('.seg button')) {
      const setting = target.parentElement?.dataset.setting
      if (setting === 'quality') this.actions.settings({ quality: target.dataset.value as Quality })
      if (setting === 'controlMode') this.actions.settings({ controlMode: target.dataset.value as ControlMode })
      this.refreshSettings()
      this.audio.play('ui')
      return
    }
    const action = target.dataset.action
    const drone = target.dataset.drone
    switch (action) {
      case 'play': this.actions.play(); break
      case 'online': this.push('online'); break
      case 'online-create': {
        const name = this.root.querySelector<HTMLInputElement>('[name="nickname"]')?.value ?? ''
        this.actions.onlineCreate(name)
        break
      }
      case 'online-join': {
        const name = this.root.querySelector<HTMLInputElement>('[name="nickname"]')?.value ?? ''
        const room = this.root.querySelector<HTMLInputElement>('[name="room"]')?.value ?? ''
        this.actions.onlineJoin(name, room)
        break
      }
      case 'online-copy': {
        const url = new URL(location.href)
        const code = this.root.querySelector<HTMLInputElement>('[name="room"]')?.value ?? ''
        url.searchParams.set('room', code)
        void navigator.clipboard?.writeText(url.href).then(() => this.banner(this.i18n.t('online.copyDone')))
        break
      }
      case 'resume': this.actions.resume(); break
      case 'restart': this.actions.restart(); break
      case 'quit': this.actions.quit(); break
      case 'settings': this.push('settings'); break
      case 'controls': this.push('controls'); break
      case 'hangar': this.selectedDrone = this.save.data.selected; this.push('hangar'); break
      case 'inspect': if (drone) { this.selectedDrone = drone; this.renderHangar() } break
      case 'buy': if (drone) this.actions.buy(drone); break
      case 'select': if (drone) this.actions.select(drone); break
      case 'upgrade': if (target.dataset.upgrade) this.actions.upgrade(target.dataset.upgrade as UpgradeKey); break
      case 'back': this.back(); break
      case 'pause': window.dispatchEvent(new CustomEvent('game:pause')); break
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    if (el.type !== 'range') return
    el.style.setProperty('--fill', `${((Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min))) * 100}%`)
    this.actions.settings({ [el.name]: Number(el.value) } as Partial<SaveData>)
  }

  private onKey(e: KeyboardEvent): void {
    if (this.screen === 'hud' || this.screen === 'boot') return
    const typing = (e.target as HTMLElement).matches?.('input[type="text"]')
    if ((e.code === 'Escape' || (e.code === 'Backspace' && !typing)) && this.screen !== 'title') {
      if (this.screen !== 'pause' && this.screen !== 'results') {
        e.preventDefault()
        this.input.consume('pause')
        this.back()
      }
      return
    }
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault()
      this.moveFocus(e.code === 'ArrowDown' ? 1 : -1)
    }
  }

  /** Kare başına gamepad menü gezinmesi (klavye yerleşik odak kullanır). */
  frame(frameSeconds: number): void {
    if (this.input.method !== this.lastMethod) {
      this.lastMethod = this.input.method
      this.renderPrompts()
      if (this.hintText) this.hint(this.hintText)
    }
    if (this.screen === 'hud' || this.screen === 'boot') return
    if (this.input.method !== 'gamepad') {
      this.input.consume('confirm')
      this.input.consume('back')
      return
    }
    const y = this.input.move.y
    const x = this.input.move.x
    this.navRepeat = Math.max(0, this.navRepeat - frameSeconds)
    const active = document.activeElement as HTMLElement | null
    if (Math.abs(y) > 0.6 && this.navRepeat <= 0) {
      this.moveFocus(y < 0 ? 1 : -1)
      this.navRepeat = 0.22
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.matches('input[type="range"]')) {
      const r = active as HTMLInputElement
      r.value = String(Number(r.value) + Math.sign(x) * Number(r.step || 0.1))
      r.dispatchEvent(new Event('input', { bubbles: true }))
      this.navRepeat = 0.12
    } else if (Math.abs(x) > 0.6 && this.navRepeat <= 0 && active?.parentElement?.matches('.seg')) {
      const sib = (Math.sign(x) > 0 ? active.nextElementSibling : active.previousElementSibling) as HTMLElement | null
      sib?.focus()
      this.navRepeat = 0.22
    } else if (Math.abs(y) < 0.3 && Math.abs(x) < 0.3) {
      this.navRepeat = 0
    }
    if (this.input.consume('confirm')) (document.activeElement as HTMLElement | null)?.click()
    if (this.input.consume('back') && this.screen !== 'title') this.back()
  }

  private navItems(): HTMLElement[] {
    const screen = this.root.querySelector(`[data-screen="${this.screen}"]`)
    if (!screen) return []
    return [...screen.querySelectorAll<HTMLElement>('[data-nav]')].filter(el => el.offsetParent !== null && !el.closest('.is-hidden') && !(el as HTMLButtonElement).disabled)
  }

  private moveFocus(dir: 1 | -1): void {
    const items = this.navItems()
    if (items.length === 0) return
    const rows: HTMLElement[][] = []
    for (const el of items) {
      const seg = el.parentElement?.matches('.seg') ? el.parentElement : null
      const last = rows[rows.length - 1]
      if (seg && last && last[0].parentElement === seg) last.push(el)
      else rows.push([el])
    }
    const current = rows.findIndex(r => r.includes(document.activeElement as HTMLElement))
    const next = rows[(current + dir + rows.length) % rows.length]
    ;(next.find(el => el.getAttribute('aria-pressed') === 'true') ?? next[0]).focus()
  }

  // ─── yardımcılar ──────────────────────────────────────────────────────────

  private translate(scope: ParentNode = this.root): void {
    for (const el of scope.querySelectorAll<HTMLElement>('[data-i18n]')) el.textContent = this.i18n.t(el.dataset.i18n!)
    for (const el of scope.querySelectorAll<HTMLElement>('[data-i18n-label]')) el.setAttribute('aria-label', this.i18n.t(el.dataset.i18nLabel!))
    this.renderPrompts()
    document.title = this.i18n.t('game.title')
  }

  private renderPrompts(): void {
    const html = this.input.method === 'touch' ? '' : `<span><kbd>ENTER</kbd> ${this.i18n.t('hangar.select')}</span><span><kbd>ESC</kbd> ${this.i18n.t('common.back')}</span>`
    for (const el of this.root.querySelectorAll('.prompts')) el.innerHTML = html
  }

  private set(slot: string, text: string): boolean {
    if (this.hudCache.get(slot) === text) return false
    this.hudCache.set(slot, text)
    const el = this.root.querySelector(`[data-slot="${slot}"]`)
    if (el) el.textContent = text
    return true
  }

  private text(selector: string, value: string): void {
    const el = this.root.querySelector(selector)
    if (el) el.textContent = value
  }

  private value(selector: string, value: number): void {
    const el = this.root.querySelector<HTMLInputElement>(selector)
    if (el) el.value = String(value)
  }

  private template(): string {
    const range = (name: string, label: string, min: number, max: number, step: number) =>
      `<label class="row"><span data-i18n="${label}"></span><input data-nav type="range" name="${name}" min="${min}" max="${max}" step="${step}"></label>`
    const toggle = (setting: string, label: string) =>
      `<div class="row"><span data-i18n="${label}"></span><button data-nav class="toggle" data-setting="${setting}" aria-pressed="false"><i></i><span></span></button></div>`
    const control = (key: string, label: string) =>
      `<div class="ctrl-row"><kbd>${key}</kbd><span data-i18n="${label}"></span></div>`

    return /* html */ `
<section class="screen screen-boot" data-screen="boot">
  <div class="boot-inner">
    <img class="boot-mark" src="./favicon.png" alt="" width="72" height="72" />
    <h1 class="boot-title" data-i18n="game.title"></h1>
    <div class="boot-bar"><i></i></div>
    <p class="boot-label" data-i18n="boot.loading"></p>
  </div>
</section>

<section class="screen screen-title" data-screen="title">
  <div class="title-grid">
    <div class="title-main">
      <p class="eyebrow">İNSANSIZ HAVA MUHAREBE SİMÜLATÖRÜ</p>
      <h1 class="wordmark">ROTOR<span>STRIKE</span></h1>
      <p class="tagline" data-i18n="game.tagline"></p>
      <nav class="menu">
        <button data-nav class="btn btn-primary" data-action="play"><span data-i18n="menu.start"></span></button>
        <button data-nav class="btn" data-action="online"><span data-i18n="menu.online"></span></button>
        <button data-nav class="btn" data-action="hangar"><span data-i18n="menu.hangar"></span></button>
        <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
        <button data-nav class="btn" data-action="controls"><span data-i18n="menu.controls"></span></button>
      </nav>
    </div>
    <aside class="dossier">
      <header><span data-i18n="title.pilot"></span><i>${ICON.drone}</i></header>
      <div class="dossier-row"><span data-i18n="title.credits"></span><b class="js-credits">0</b></div>
      <div class="dossier-row"><span data-i18n="title.drone"></span><b class="js-drone">—</b></div>
      <div class="dossier-row"><span data-i18n="title.best"></span><b class="js-best">—</b></div>
      <div class="dossier-row"><span data-i18n="results.kills"></span><b class="js-kills">0</b></div>
    </aside>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div><small data-i18n="credits.fonts"></small></footer>
</section>

<section class="screen screen-modal" data-screen="online">
  <div class="online-panel">
    <h2 data-i18n="online.title"></h2>
    <label class="online-field"><span data-i18n="online.nickname"></span><input data-nav name="nickname" maxlength="18" autocomplete="nickname" required value="${this.save.data.nickname.replace(/[<>&"]/g, '')}"></label>
    <small data-i18n="online.nameHint"></small>
    <label class="online-field"><span data-i18n="online.room"></span><input data-nav name="room" maxlength="6" autocomplete="off" inputmode="text" placeholder="ABC123" value="${new URL(location.href).searchParams.get('room')?.replace(/[^a-z0-9]/gi, '').slice(0, 6) ?? ''}"></label>
    <div class="online-status" aria-live="polite"></div>
    <button data-nav class="btn btn-primary" data-action="online-create"><span data-i18n="online.create"></span></button>
    <button data-nav class="btn" data-action="online-join"><span data-i18n="online.join"></span></button>
    <button data-nav class="btn btn-small" data-action="back"><span data-i18n="common.back"></span></button>
  </div>
</section>

<section class="screen screen-hangar" data-screen="hangar">
  <div class="hangar">
    <header class="hangar-head">
      <h2 data-i18n="hangar.title"></h2>
      <div class="wallet"><span data-i18n="hangar.credits"></span><b class="js-wallet">0</b><em>KR</em></div>
    </header>
    <div class="hangar-body">
      <div class="drone-list js-drone-list"></div>
      <aside class="drone-detail js-drone-detail"></aside>
    </div>
    <footer class="hangar-foot"><button data-nav class="btn btn-small" data-action="back"><span data-i18n="common.back"></span></button></footer>
  </div>
</section>

<section class="screen screen-hud" data-screen="hud">
  <div class="hurt-vignette"></div>
  <div class="popups"></div>
  <div class="hud-top-left">
    <div class="hud-drone">
      <span class="hud-drone-icon">${ICON.drone}</span>
      <b class="js-hud-drone">RQ-1 ARICI</b>
    </div>
    <div class="hud-hp"><span data-i18n="hud.hp"></span><div class="hud-hp-cells"></div></div>
    <div class="hud-repair"><span data-i18n="hud.repairing"></span><b data-slot="repair"></b></div>
  </div>
  <div class="hud-top-center">
    <div class="hud-wave"><span data-i18n="hud.waveLabel"></span><b data-slot="wave">1</b></div>
    <div class="hud-targets" data-slot="targets">0 HEDEF</div>
    <div class="hud-online-room"></div>
    <button class="card-btn hud-invite" data-action="online-copy" data-i18n="online.copy"></button>
  </div>
  <div class="hud-top-right">
    <div class="hud-stat"><span data-i18n="hud.credits"></span><b data-slot="credits">0</b></div>
    <div class="hud-stat"><span data-i18n="hud.score"></span><b data-slot="score">0</b></div>
    <button class="hud-pause" data-action="pause" data-i18n-label="pause.title">${ICON.pause}</button>
  </div>
  <div class="killfeed"></div>
  <div class="crosshair">${ICON.crosshair}</div>
  <div class="hud-bottom-left">
    <div class="gauge"><span data-i18n="hud.speed"></span><b data-slot="speed">0</b><em>KM/S</em></div>
    <div class="gauge"><span data-i18n="hud.alt"></span><b data-slot="alt">0</b><em>M</em></div>
  </div>
  <div class="hud-ammo"><span data-i18n="hud.ammo"></span><b data-slot="ammo">20 / 20</b><div class="hud-reload-bar"><i class="hud-reload-fill"></i></div><small data-slot="reload"></small></div>
  <div class="banner"></div>
  <div class="hint"><span></span></div>
  <div class="touch">
    <div class="touch-hint touch-move-hint" data-i18n="touch.move">HAREKET</div>
    <div class="touch-hint touch-look-hint" data-i18n="touch.look">SAĞI SÜRÜKLE: NİŞAN</div>
    <div class="touch-stick"><i></i></div>
    <button class="touch-btn touch-fire" data-touch="fire"><span data-i18n="touch.fire">ATEŞ</span></button>
    <button class="touch-btn touch-climb" data-touch="climb"><span data-i18n="touch.climb">YÜKSEL</span></button>
    <button class="touch-btn touch-descend" data-touch="descend"><span data-i18n="touch.descend">ALÇAL</span></button>
  </div>
</section>

<section class="screen screen-pause screen-modal" data-screen="pause">
  <div class="modal">
    <h2 class="modal-title" data-i18n="pause.title"></h2>
    <nav class="menu">
      <button data-nav class="btn btn-primary" data-action="resume"><span data-i18n="pause.continue"></span></button>
      <button data-nav class="btn" data-action="restart"><span data-i18n="pause.restart"></span></button>
      <button data-nav class="btn" data-action="settings"><span data-i18n="menu.settings"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="pause.quit"></span></button>
    </nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-settings screen-modal" data-screen="settings">
  <div class="modal modal-wide">
    <h2 class="modal-title" data-i18n="settings.title"></h2>
    <div class="settings-grid">
      <fieldset><legend data-i18n="settings.audio"></legend>
        ${range('musicVolume', 'settings.music', 0, 1, 0.05)}
        ${range('sfxVolume', 'settings.sfx', 0, 1, 0.05)}
        ${toggle('muted', 'settings.mute')}
      </fieldset>
      <fieldset><legend data-i18n="settings.controls"></legend>
        <div class="row"><span data-i18n="settings.controlMode"></span><div class="seg" data-setting="controlMode">
          <button data-nav data-value="auto" data-i18n="settings.controlAuto"></button><button data-nav data-value="pc" data-i18n="settings.controlPc"></button><button data-nav data-value="android" data-i18n="settings.controlAndroid"></button>
        </div></div>
        ${range('sensitivity', 'settings.sensitivity', 0.2, 3, 0.1)}
        ${toggle('invertY', 'settings.invertY')}
        ${toggle('stabilize', 'settings.stabilize')}
        <p class="field-note" data-i18n="settings.stabilizeHint"></p>
      </fieldset>
      <fieldset><legend data-i18n="settings.display"></legend>
        <div class="row"><span data-i18n="settings.quality"></span><div class="seg" data-setting="quality">
          <button data-nav data-value="low" data-i18n="settings.quality.low"></button><button data-nav data-value="medium" data-i18n="settings.quality.medium"></button><button data-nav data-value="high" data-i18n="settings.quality.high"></button>
        </div></div>
        ${toggle('reducedMotion', 'settings.reducedMotion')}
      </fieldset>
    </div>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="common.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-controls screen-modal" data-screen="controls">
  <div class="modal">
    <h2 class="modal-title" data-i18n="controls.title"></h2>
    <div class="ctrl-grid">
      ${control('W A S D', 'controls.move')}
      ${control('SPACE', 'controls.climb')}
      ${control('SHIFT', 'controls.descend')}
      ${control('SOL TIK', 'controls.fire')}
      ${control('FARE', 'controls.aim')}
      ${control('X', 'controls.stabilize')}
      ${control('ESC', 'controls.pause')}
    </div>
    <p class="field-note" data-i18n="controls.hint"></p>
    <nav class="menu menu-row"><button data-nav class="btn" data-action="back"><span data-i18n="common.back"></span></button></nav>
  </div>
  <footer class="bottom-bar"><div class="prompts"></div></footer>
</section>

<section class="screen screen-results screen-modal" data-screen="results">
  <div class="modal modal-results">
    <h2 class="results-title modal-title" data-i18n="results.title"></h2>
    <div class="results-best" data-i18n="results.newBest"></div>
    <dl class="results-table">
      <div><dt data-i18n="results.wave"></dt><dd class="r-wave">1</dd></div>
      <div><dt data-i18n="results.kills"></dt><dd class="r-kills">0</dd></div>
      <div><dt data-i18n="results.hits"></dt><dd class="r-hits">0</dd></div>
      <div><dt data-i18n="results.score"></dt><dd class="r-score">0</dd></div>
      <div><dt data-i18n="results.time"></dt><dd class="r-time">00:00</dd></div>
      <div class="r-sep"><dt data-i18n="results.earnHits"></dt><dd class="r-earn-hits">0</dd></div>
      <div><dt data-i18n="results.earnKills"></dt><dd class="r-earn-kills">0</dd></div>
      <div><dt data-i18n="results.earnWaves"></dt><dd class="r-earn-waves">0</dd></div>
      <div><dt data-i18n="results.earnSurvival"></dt><dd class="r-earn-survival">0</dd></div>
      <div class="r-total-row"><dt data-i18n="results.earned"></dt><dd class="r-earned">0</dd></div>
      <div class="r-balance-row"><dt data-i18n="results.balance"></dt><dd class="r-balance">0</dd></div>
    </dl>
    <nav class="menu menu-row">
      <button data-nav class="btn btn-primary" data-action="restart"><span data-i18n="results.retry"></span></button>
      <button data-nav class="btn" data-action="hangar"><span data-i18n="results.hangar"></span></button>
      <button data-nav class="btn" data-action="quit"><span data-i18n="results.menu"></span></button>
    </nav>
  </div>
</section>`
  }

  get currentRun(): import('../game/rules').RunState | null {
    return this.lastRun
  }
}
