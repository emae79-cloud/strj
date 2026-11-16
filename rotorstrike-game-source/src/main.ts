import './styles/main.css'
import { Audio } from './engine/audio'
import { I18n } from './engine/i18n'
import { Input } from './engine/input'
import { GameLoop } from './engine/loop'
import { SAVE_KEY, SaveStore, type SaveData } from './engine/save'
import type { Game } from './game/game'
import { DEFAULT_UPGRADES, DRONES, UPGRADES, droneById, upgradeCost, type UpgradeKey } from './game/hangar'
import type { RunState } from './game/rules'
import { TouchControls } from './ui/touch'
import { Ui } from './ui/ui'
import { cleanNickname, cleanRoom, MultiplayerClient, newRoomCode } from './net/multiplayer'

const TEST_MODE_KEY = 'rotorstrike.localTestMode.v1'

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#game')!
  const firstRun = readSave() === null
  const save = new SaveStore()
  const i18n = new I18n()
  const input = new Input(canvas)
  const audio = new Audio()
  let game: Game | undefined
  let ui!: Ui
  let net: MultiplayerClient | null = null
  let onlineStarted = false
  let lockLostAt = 0
  let credited = false
  let testMode = readTestMode()
  let testFlight = false
  let testDroneId = save.data.selected

  const applySettings = (d: SaveData) => {
    input.sensitivity = d.sensitivity
    input.invertY = d.invertY
    input.setControlMode(d.controlMode)
    audio.setVolumes(d.musicVolume, d.sfxVolume, d.muted)
    if (game) {
      game.reducedMotion = d.reducedMotion
      game.setStabilize(d.stabilize)
    }
  }

  const startRun = (tutorial: boolean, online = false, droneId?: string, trial = false) => {
    if (!game) return
    if (trial && (!testMode || online)) return
    audio.unlock()
    audio.startMusic()
    credited = false
    const d = save.data
    const runningDrone = trial ? (droneId ?? d.selected) : d.selected
    testFlight = trial
    if (trial) {
      testDroneId = runningDrone
      onlineStarted = false
      net?.disconnect()
    }
    game.setOnlineHandlers(online && net ? {
      name: d.nickname,
      pose: pose => net?.sendPose(pose),
      fire: (origin, direction, blocked, targetSeat) => net?.fire(origin, direction, blocked, targetSeat),
    } : null)
    game.start(runningDrone, trial ? DEFAULT_UPGRADES : d.upgrades, tutorial && !online && !trial, d.stabilize, online)
    ui.setDrone(droneById(runningDrone).name)
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }

  const pause = () => {
    if (game?.mode !== 'playing') return
    game.pause()
    ui.show('pause')
    input.unlockPointer()
  }

  const resume = () => {
    if (game?.mode !== 'paused') return
    game.resume()
    ui.show('hud')
    loop.resetAccumulator()
    input.lockPointer()
  }

  const quit = () => {
    if (testFlight) {
      testFlight = false
      game?.toTitle()
      audio.stopMusic()
      ui.show('hangar')
      input.unlockPointer()
      return
    }
    onlineStarted = false
    net?.disconnect()
    game?.toTitle()
    game?.setStabilize(save.data.stabilize)
    audio.stopMusic()
    ui.show('title')
    input.unlockPointer()
  }

  /** Koşu kazancını kalıcı kayda işler (tek sefer). */
  const bank = (run: RunState) => {
    if (credited) return
    credited = true
    const d = save.data
    save.update({
      credits: d.credits + run.credits,
      totals: {
        runs: d.totals.runs + 1,
        kills: d.totals.kills + run.kills,
        deaths: d.totals.deaths + 1,
        earned: d.totals.earned + run.credits,
      },
      best: {
        score: Math.max(d.best.score, run.score),
        wave: Math.max(d.best.wave, run.wave),
        kills: Math.max(d.best.kills, run.kills),
      },
    })
  }

  net = new MultiplayerClient({
    state: (state, detail) => {
      ui?.onlineStatus(state, detail)
      if (state === 'retry' && onlineStarted && game?.mode === 'playing') game.pause()
      if (state === 'online' && onlineStarted && game?.mode === 'paused') game.resume()
      if (state === 'retry') ui?.onlineRoom('⟳', 0)
    },
    message: message => {
      game?.receiveOnlineMessage(message)
      if (message.type === 'welcome' && game) {
        if (!onlineStarted) { onlineStarted = true; startRun(false, true) }
        ui?.show('hud')
        ui?.onlineRoom(net?.room ?? '', 1)
      }
      if (message.type === 'room' && Array.isArray(message.players)) ui?.onlineRoom(net?.room ?? '', message.players.length)
      if (message.type === 'error' && message.code === 'room_full') ui?.onlineStatus('full')
    },
  })
  const onlineConnect = (nicknameRaw: string, roomRaw: string) => {
    const nickname = cleanNickname(nicknameRaw)
    const room = cleanRoom(roomRaw)
    if (!nickname || room.length !== 6) { ui?.onlineStatus('unavailable', 'invalid_nickname'); return }
    ui?.setOnlineRoomCode(room)
    save.update({ nickname })
    onlineStarted = false
    const url = new URL(location.href)
    url.searchParams.set('room', room)
    history.replaceState(null, '', url)
    void net?.connect(room, nickname)
  }

  const setTestMode = (enabled: boolean) => {
    testMode = enabled
    try {
      if (enabled) localStorage.setItem(TEST_MODE_KEY, '1')
      else localStorage.removeItem(TEST_MODE_KEY)
    } catch { /* test mode remains session-local if storage is blocked */ }
    ui?.setTestMode(enabled)
  }

  ui = new Ui(i18n, save, audio, input, {
    play: () => startRun(!save.data.tutorialDone),
    onlineCreate: nickname => onlineConnect(nickname, newRoomCode()),
    onlineJoin: (nickname, room) => onlineConnect(nickname, room),
    tryDrone: id => {
      if (testMode) startRun(false, false, id, true)
    },
    toggleTestMode: () => setTestMode(!testMode),
    onlineCancel: () => {
      onlineStarted = false
      net?.disconnect()
      const url = new URL(location.href); url.searchParams.delete('room'); history.replaceState(null, '', url)
      ui?.onlineStatus('idle')
    },
    restart: () => testFlight ? startRun(false, false, testDroneId, true) : startRun(false),
    resume,
    quit,
    settings: patch => {
      const qualityChanged = patch.quality !== undefined && patch.quality !== save.data.quality
      save.update(patch)
      applySettings(save.data)
      if (qualityChanged) game?.setQuality(save.data.quality)
    },
    buy: id => {
      const spec = DRONES.find(drone => drone.id === id)
      if (!spec) return
      const d = save.data
      if (d.owned.includes(spec.id) || d.credits < spec.price) return
      save.update({ credits: d.credits - spec.price, owned: [...d.owned, spec.id], selected: spec.id })
      audio.play('buy')
      ui.renderHangar()
      ui.renderTitle()
    },
    select: id => {
      if (!save.data.owned.includes(id)) return
      save.update({ selected: id })
      audio.play('ui')
      ui.renderHangar()
      ui.renderTitle()
    },
    upgrade: key => {
      const spec = UPGRADES.find(u => u.key === key)
      if (!spec) return
      const d = save.data
      const level = d.upgrades[key as UpgradeKey]
      const cost = upgradeCost(key as UpgradeKey, level)
      if (level >= spec.maxLevel || d.credits < cost) return
      save.update({ credits: d.credits - cost, upgrades: { ...d.upgrades, [key]: level + 1 } })
      audio.play('buy')
      ui.renderHangar()
      ui.renderTitle()
    },
    stabilize: on => {
      save.update({ stabilize: on })
      game?.setStabilize(on)
    },
  })
  ui.setTestMode(testMode)
  const wordmarkTaps: number[] = []
  document.querySelector('.wordmark')?.addEventListener('click', () => {
    const now = performance.now()
    while (wordmarkTaps.length && now - wordmarkTaps[0] > 1600) wordmarkTaps.shift()
    wordmarkTaps.push(now)
    if (wordmarkTaps.length >= 5) {
      wordmarkTaps.length = 0
      setTestMode(!testMode)
      audio.play('ui')
    }
  })
  ui.show('boot')
  applySettings(save.data)

  // Yükleme: three.js, Rapier (WASM) ve oyun ayrı bir chunk olarak ilerleme çubuğunun arkasında.
  let loaded = 0
  const track = <T>(p: Promise<T>): Promise<T> => p.then(v => (ui.setBootProgress(0.1 + (++loaded / 4) * 0.9), v))
  ui.setBootProgress(0.1)
  const [{ Game }, { Renderer, suggestQuality }, physics] = await Promise.all([
    track(import('./game/game')),
    track(import('./engine/renderer')),
    track(import('./engine/physics')),
    track(document.fonts.ready),
  ])
  await physics.initPhysics()

  // İlk açılışta donanıma uygun kalite kademesi seçilir; sonra oyuncunun seçimi geçerlidir.
  if (firstRun) save.update({ quality: suggestQuality() })
  const renderer = new Renderer(canvas, save.data.quality)
  game = new Game(renderer, input, audio, {
    popup: (text, at, kind) => ui.popup(text, at, kind),
    hurt: () => ui.hurt(),
    kill: text => ui.kill(text),
    hint: text => ui.hint(text),
    banner: text => ui.banner(text),
    end: run => {
      input.unlockPointer()
      if (testFlight) {
        window.setTimeout(() => {
          if (!testFlight) return
          testFlight = false
          game?.toTitle()
          audio.stopMusic()
          ui.show('hangar')
        }, 1100)
      } else {
        bank(run)
        window.setTimeout(() => ui.showResults(run), 1100)
      }
    },
    t: (key, vars) => i18n.t(key, vars),
  })
  game.reducedMotion = save.data.reducedMotion
  game.setStabilize(save.data.stabilize)
  if (import.meta.env.DEV) {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./game/tuning'),
    ])
    await registerGameTuning(tuning)
  }
  const g = game

  const loop = new GameLoop({
    beforeFrame: frameSeconds => input.update(frameSeconds),
    step: dt => g.step(dt),
    render: (alpha, frameSeconds) => {
      if (input.consume('pause') && performance.now() - lockLostAt > 300) {
        if (g.mode === 'playing') pause()
        else if (g.mode === 'paused' && ui.screen === 'pause') resume()
      }
      ui.frame(frameSeconds)
      loop.paused = g.mode === 'paused'
      g.render(alpha, frameSeconds)
      if (g.mode === 'playing' || g.mode === 'ended') ui.updateHud(g.hud())
    },
  })
  loop.start()

  document.addEventListener('pointerlockchange', () => {
    // Tarayıcı Escape'te pointer lock'ı tuş iletmeden bırakır: bunu duraklatma say.
    if (!document.pointerLockElement && g.mode === 'playing' && input.method === 'keyboard') {
      lockLostAt = performance.now()
      pause()
    }
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause()
  })
  window.addEventListener('game:pause', pause)
  canvas.addEventListener('click', () => {
    if (g.mode === 'playing') input.lockPointer()
  })
  new TouchControls(document.getElementById('ui')!, input, () => g.mode === 'playing')

  window.setTimeout(() => ui.show('title'), 250)
  // Hata ayıklama/test kancası (salt okunur): smoke testleri koşu durumunu buradan inceler.
  ;(window as unknown as { __game: unknown }).__game = { game: g, ui, input, save, audio }
}

function readSave(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY)
  } catch {
    return null
  }
}

function readTestMode(): boolean {
  try {
    return localStorage.getItem(TEST_MODE_KEY) === '1'
  } catch {
    return false
  }
}

boot().catch(err => {
  console.error(err)
  const el = document.getElementById('ui')
  if (el) el.innerHTML = `<div class="fatal">Oyun başlatılamadı: ${String((err as Error)?.message ?? err).replace(/[<>&]/g, '')}</div>`
})
