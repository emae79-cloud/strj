import * as THREE from 'three'
import type { Audio } from '../engine/audio'
import type { Input } from '../engine/input'
import { Physics, RAPIER } from '../engine/physics'
import type { Renderer } from '../engine/renderer'
import type { Quality } from '../engine/save'
import { Arena, ARENA } from './arena'
import { CockpitCamera } from './camera'
import { CONFIG } from './config'
import { Enemies, ENEMY_TYPES, type Enemy, type EnemyFire, type EnemyType } from './enemies'
import { Effects } from './fx'
import { droneById, resolveLoadout, type DroneSpec, type UpgradeLevels } from './hangar'
import { PlayerDrone, type FlightEvent } from './player'
import { buildDrone, type DroneVisual } from './models'
import type { PilotPose } from '../net/multiplayer'
import {
  createRun,
  damagePlayer,
  registerHit,
  registerKill,
  repair,
  tick,
  waveEnemyCount,
  type RunState,
} from './rules'
import { applySpread, raySphere, Tracers } from './weapons'

export type Mode = 'attract' | 'playing' | 'paused' | 'ended'

export type HudState = {
  hp: number
  maxHp: number
  wave: number
  wavePhase: RunState['wavePhase']
  intermission: number
  enemiesLeft: number
  speed: number
  altitude: number
  ammo: number
  magazineSize: number
  reloadRemaining: number
  reloadDuration: number
  credits: number
  score: number
  stabilizing: boolean
  repairIn: number
}

export type GameHooks = {
  popup(text: string, screen: { x: number; y: number }, kind: 'score' | 'hurt' | 'kill'): void
  hurt(): void
  kill(text: string): void
  hint(text: string | null): void
  banner(text: string): void
  end(run: RunState): void
  t(key: string, vars?: Record<string, string | number>): string
}

type OnlinePlayer = { seat: string; name: string; drone: string; hp: number; ammo: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number; roll: number }
type RemotePilot = { root: THREE.Group; visual: DroneVisual; label: THREE.Sprite; target: THREE.Vector3; velocity: THREE.Vector3; receivedAt: number; yaw: number; pitch: number; roll: number }

/**
 * Tek oynanabilir sahne: arena, fizik, oyuncu dronu, kamera, düşmanlar ve koşu kurallarını
 * sahiplenir; simülasyon olaylarını sese, parçacıklara ve arayüz kancalarına çevirir.
 */
export class Game {
  mode: Mode = 'attract'
  run: RunState
  reducedMotion = false
  stabilize = true
  private readonly physics: Physics
  private readonly arena: Arena
  private readonly enemies = new Enemies()
  private readonly tracers = new Tracers()
  private readonly fx = new Effects()
  private readonly attractCamera = new THREE.PerspectiveCamera(58, 1, 1, 1600)
  private player?: PlayerDrone
  private cam?: CockpitCamera
  private spec: DroneSpec = droneById('rq1')
  private levels: UpgradeLevels = { weapon: 0, motor: 0, hull: 0 }
  private simTime = 0
  private time = 0
  private invuln = 0
  private sinceDamage = 0
  private spawnTimer = 0
  private spawnedThisWave = 0
  private lastWave = 1
  private hintStage = 0
  private hintTimer = 0
  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })
  private readonly tmp = new THREE.Vector3()
  private online = false
  private onlineSeat = ''
  private onlinePoseTimer = 0
  private readonly remotePilots = new Map<string, RemotePilot>()
  private onlineHandlers: { name: string; pose(pose: Omit<PilotPose, 'type' | 'build' | 'seat' | 'seq' | 'name'>): void; fire(origin: THREE.Vector3, direction: THREE.Vector3): void } | null = null

  constructor(
    private readonly renderer: Renderer,
    private readonly input: Input,
    private readonly audio: Audio,
    private readonly hooks: GameHooks,
  ) {
    this.physics = new Physics(0)
    this.arena = new Arena(this.physics, renderer.shadowMapSize)
    this.arena.scene.add(this.enemies.group, this.tracers.mesh, this.fx.mesh)
    this.run = createRun()
    this.attractCamera.position.set(0, 96, 250)
    this.attractCamera.lookAt(0, 46, -90)
  }

  get camera(): THREE.PerspectiveCamera {
    return this.mode === 'attract' ? this.attractCamera : (this.cam?.camera ?? this.attractCamera)
  }

  get loadout() {
    const base = {
      maxSpeed: CONFIG.flight.maxSpeed,
      accel: CONFIG.flight.accel,
      vertical: CONFIG.flight.vertical,
      fireRate: CONFIG.weapon.fireRate,
      range: CONFIG.weapon.range,
    }
    return resolveLoadout(this.spec, this.levels, base)
  }

  /** Koşuyu başlat: seçili dronu ve yükseltmeleri uygula. */
  start(droneId: string, levels: UpgradeLevels, tutorial: boolean, stabilize: boolean, online = false): void {
    this.spec = droneById(droneId)
    this.levels = { ...levels }
    this.stabilize = stabilize
    this.online = online
    this.onlinePoseTimer = 0
    this.onlineSeat = ''
    this.clearRemotePilots()
    this.mountPlayer()
    this.enemies.clear()
    this.tracers.clear()
    this.fx.clear()
    this.run = createRun()
    this.spawnedThisWave = 0
    this.spawnTimer = online ? 9999 : 0.8
    this.lastWave = 1
    this.invuln = CONFIG.drone.invulnerable
    this.sinceDamage = 0
    this.hintStage = tutorial ? 0 : 3
    this.hintTimer = 5
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
    const touch = this.input.touchEnabled || this.input.method === 'touch'
    this.hooks.hint(tutorial ? this.hooks.t(touch ? 'hint.flightTouch' : 'hint.flight') : null)
    this.hooks.banner(this.hooks.t('hud.wave', { n: 1 }))
  }

  setOnlineHandlers(handlers: typeof this.onlineHandlers): void { this.onlineHandlers = handlers }

  receiveOnlineMessage(message: Record<string, unknown>): void {
    if (message.type === 'welcome' && typeof message.seat === 'string') this.onlineSeat = message.seat
    if (message.type === 'room' && Array.isArray(message.players)) {
      const seen = new Set<string>()
      for (const item of message.players) {
        if (!item || typeof item !== 'object') continue
        const p = item as Partial<OnlinePlayer>
        if (typeof p.seat !== 'string' || p.seat === this.onlineSeat || ![p.x,p.y,p.z,p.yaw,p.pitch,p.roll].every(Number.isFinite)) continue
        seen.add(p.seat)
        let remote = this.remotePilots.get(p.seat)
        if (!remote) {
          const spec = droneById(typeof p.drone === 'string' ? p.drone : 'rq1')
          const visual = buildDrone(spec.frame, spec.palette)
          const root = new THREE.Group()
          root.add(visual.root)
          const canvas = document.createElement('canvas')
          canvas.width = 512; canvas.height = 96
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#e8eef0'; ctx.font = '600 40px Barlow Condensed, sans-serif'; ctx.textAlign = 'center'
          ctx.shadowColor = '#000'; ctx.shadowBlur = 8
          ctx.fillText((typeof p.name === 'string' ? p.name : 'PİLOT').slice(0, 18), 256, 62)
          const texture = new THREE.CanvasTexture(canvas)
          const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
          label.scale.set(5, 0.94, 1); label.position.y = 2.1
          root.add(label); this.arena.scene.add(root)
        remote = { root, visual, label, target: new THREE.Vector3(p.x!, p.y!, p.z!), velocity: new THREE.Vector3(), receivedAt: performance.now(), yaw: p.yaw ?? 0, pitch: p.pitch ?? 0, roll: p.roll ?? 0 }
          this.remotePilots.set(p.seat, remote)
        }
        remote.target.set(p.x!, p.y!, p.z!)
        remote.velocity.set(p.vx ?? 0, p.vy ?? 0, p.vz ?? 0)
        remote.receivedAt = performance.now()
        remote.yaw = p.yaw ?? remote.yaw; remote.pitch = p.pitch ?? remote.pitch; remote.roll = p.roll ?? remote.roll
      }
      for (const seat of this.remotePilots.keys()) if (!seen.has(seat)) this.removeRemotePilot(seat)
      const own = (message.players as OnlinePlayer[]).find(p => p?.seat === this.onlineSeat)
      if (own) { this.run.hp = own.hp; if (this.player) this.player.ammo = own.ammo }
    }
    if (message.type === 'shot' || message.type === 'ammo' || message.type === 'respawn') {
      if (this.player && Number.isFinite(message.ammo)) this.player.ammo = Number(message.ammo)
      if (this.player && Number.isFinite(message.reloadMs)) this.player.reloadRemaining = Number(message.reloadMs) / 1000
    }
    if (message.type === 'damage' && Number.isFinite(message.hp)) {
      this.run.hp = Number(message.hp)
      if (this.run.hp < 4) { this.audio.play('hurt'); this.hooks.hurt() }
    }
    if (message.type === 'down') { this.run.hp = 0; this.hooks.banner('DRONE DÜŞÜRÜLDÜ') }
    if (message.type === 'respawn' && this.player) { this.run.hp = 4; this.player.teleport(ARENA.spawn, 0, 0); this.invuln = 2 }
  }

  private removeRemotePilot(seat: string): void {
    const pilot = this.remotePilots.get(seat)
    if (!pilot) return
    this.arena.scene.remove(pilot.root)
    const material = pilot.label.material as THREE.SpriteMaterial
    material.map?.dispose(); material.dispose()
    this.remotePilots.delete(seat)
  }

  private clearRemotePilots(): void { for (const seat of this.remotePilots.keys()) this.removeRemotePilot(seat) }

  pause(): void {
    if (this.mode === 'playing') this.mode = 'paused'
  }

  resume(): void {
    if (this.mode !== 'paused') return
    this.mode = 'playing'
    this.input.endFrame()
    this.input.takeLook()
  }

  toTitle(): void {
    this.mode = 'attract'
    this.online = false
    this.onlineSeat = ''
    this.onlineHandlers = null
    this.clearRemotePilots()
    this.hooks.hint(null)
  }

  setStabilize(on: boolean): void {
    this.stabilize = on
    if (this.mode === 'playing') this.hooks.banner(this.hooks.t(on ? 'hud.stabilizeOn' : 'hud.stabilizeOff'))
  }

  setQuality(quality: Quality): void {
    this.renderer.applyQuality(quality)
    const size = this.renderer.shadowMapSize
    const shadow = this.arena.sun.shadow
    shadow.map?.dispose()
    shadow.map = null
    shadow.mapSize.set(size, size)
    this.arena.scene.traverse(obj => {
      const material = (obj as THREE.Mesh).material
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.needsUpdate = true
    })
  }

  hud(): HudState {
    const player = this.player
    return {
      hp: this.run.hp,
      maxHp: this.run.maxHp,
      wave: this.run.wave,
      wavePhase: this.run.wavePhase,
      intermission: this.run.intermission,
      enemiesLeft: Math.max(0, this.run.waveTotal - this.run.waveKills),
      speed: player ? player.speed : 0,
      altitude: player ? player.position.y : 0,
      ammo: player?.ammo ?? CONFIG.weapon.magazineSize,
      magazineSize: CONFIG.weapon.magazineSize,
      reloadRemaining: player?.reloadRemaining ?? 0,
      reloadDuration: CONFIG.weapon.reloadSeconds,
      credits: this.run.credits,
      score: this.run.score,
      stabilizing: this.stabilize,
      repairIn: this.repairCountdown(),
    }
  }

  private repairCountdown(): number {
    const delay = this.loadout.repairDelay
    if (!delay || this.run.hp >= this.run.maxHp) return 0
    return Math.max(0, delay - this.sinceDamage)
  }

  private mountPlayer(): void {
    if (this.player) {
      this.arena.scene.remove(this.player.root)
      this.physics.removeBody(this.player.body)
    }
    const spawn = ARENA.spawn.clone()
    const player = new PlayerDrone(this.physics, spawn, this.spec, this.loadout)
    // Şehre ve kanyona bakan başlangıç yönü.
    player.yaw = 0
    player.pitch = -0.06
    this.player = player
    this.cam = new CockpitCamera(this.spec)
    this.arena.scene.add(player.root)
    // Kokpit görünümünde dış gövde modeli kamerayı kapatmasın; kokpit parçaları görünür.
    player.root.visible = false
    this.arena.scene.add(this.cam.camera)
  }

  step(dt: number): void {
    this.simTime += dt
    const playing = this.mode === 'playing'
    const look = this.input.takeLook()
    const fire = this.input.held('fire')
    const climb = this.input.held('climb')
    const descend = this.input.held('descend')
    const moveX = this.input.move.x
    const moveY = this.input.move.y
    const stabilizeToggle = this.input.consume('stabilize')

    if (!playing || !this.player || !this.cam) {
      this.arena.update(dt, this.player?.position ?? ARENA.spawn)
      return
    }
    if (stabilizeToggle) {
      this.stabilize = !this.stabilize
      this.hooks.banner(this.hooks.t(this.stabilize ? 'hud.stabilizeOn' : 'hud.stabilizeOff'))
    }

    this.player.look(look.x, look.y)
    const events: FlightEvent[] = []
    this.player.step(
      dt,
      { moveX, moveY, climb: (climb ? 1 : 0) - (descend ? 1 : 0), fire, stabilize: this.stabilize },
      events,
    )

    this.invuln = Math.max(0, this.invuln - dt)
    this.sinceDamage += dt
    for (const event of events) this.onFlightEvent(event)

    // Kinematik gövdelerin (oyuncu ve düşmanlar) bir sonraki konumları ancak dünya adımında uygulanır.
    this.physics.step(dt)
    const pos = this.player.position
    if (!this.online) this.updateWaves(dt, pos)
    const fires: EnemyFire[] = []
    if (!this.online) this.enemies.step(dt, pos, this.player.velocity, this.run.wave, fires)
    for (const shot of fires) this.onEnemyFire(shot, pos)

    if (this.online) {
      this.onlinePoseTimer += dt
      if (this.onlinePoseTimer >= 0.05 && this.onlineHandlers) {
        this.onlinePoseTimer = 0
        const p = this.player
        this.onlineHandlers.pose({ drone: this.spec.id, x: pos.x, y: pos.y, z: pos.z, vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z, yaw: p.yaw, pitch: p.pitch, roll: p.roll, hp: this.run.hp, ammo: p.ammo })
      }
    } else this.run = tick(this.run, dt)
    if (this.run.wave !== this.lastWave) {
      this.lastWave = this.run.wave
      this.spawnedThisWave = 0
      this.hooks.banner(this.hooks.t('hud.wave', { n: this.run.wave }))
      this.audio.play('wave')
    }
    if (this.run.wavePhase === 'intermission' && this.run.intermission > 0) {
      // Hazırlık sırasında kalan düşmanları temizle (dalga zaten bitti).
      for (const enemy of [...this.enemies.list]) this.enemies.remove(enemy)
    }

    // Onarım: hasarsız geçen süre sonunda bir can geri gelir.
    const delay = this.online ? 0 : this.loadout.repairDelay
    if (delay > 0 && this.run.hp < this.run.maxHp && this.sinceDamage >= delay) {
      this.run = repair(this.run)
      this.sinceDamage = 0
      this.audio.play('buy')
      this.hooks.popup(`+1 ${this.hooks.t('hud.hp')}`, this.project(pos), 'score')
    }

    if (this.run.phase === 'ended') {
      this.mode = 'ended'
      this.hooks.hint(null)
      this.audio.play('kill')
      this.fx.burst(pos, '#ff6a2b', 70, 12)
      this.hooks.end(this.run)
      return
    }

    this.updateHints(dt)
    this.arena.update(dt, pos)
    this.audio.setEngine(Math.min(1, (Math.abs(moveY) + Math.abs(moveX) * 0.6 + (climb ? 1 : 0)) * 0.6), Math.min(1, this.player.speed / this.loadout.maxSpeed))
  }

  render(alpha: number, frameSeconds: number): void {
    this.time += frameSeconds
    this.physics.sync(alpha)
    if (this.mode === 'attract' || !this.player || !this.cam) {
      const t = this.time * 0.06
      this.attractCamera.position.set(Math.sin(t) * 240, 88 + Math.sin(this.time * 0.3) * 10, Math.cos(t) * 240 + 20)
      this.attractCamera.lookAt(0, 40, -90)
      this.renderer.render(this.arena.scene, this.attractCamera)
      return
    }

    this.player.animate(frameSeconds, this.time, Math.min(1, this.player.speed / 30))
    this.cam.update(this.player, frameSeconds, this.reducedMotion)
    this.enemies.animate(frameSeconds, this.player.yaw, this.time)
    for (const remote of this.remotePilots.values()) {
      const lead = Math.min(0.2, Math.max(0, (performance.now() - remote.receivedAt) / 1000))
      const projected = remote.target.clone().addScaledVector(remote.velocity, lead)
      if (remote.root.position.distanceTo(projected) > 12) remote.root.position.copy(projected)
      else remote.root.position.lerp(projected, 1 - Math.exp(-frameSeconds / 0.075))
      remote.root.rotation.set(0, remote.yaw, 0)
      remote.visual.root.rotation.set(remote.pitch, 0, remote.roll)
      for (const rotor of remote.visual.rotors) rotor.rotation.y += frameSeconds * 48
    }
    this.tracers.update(frameSeconds)
    this.fx.update(frameSeconds)
    this.renderer.render(this.arena.scene, this.cam.camera)
  }

  // ─── olaylar ──────────────────────────────────────────────────────────────

  private onFlightEvent(event: FlightEvent): void {
    if (!this.player || !this.cam) return
    if (event.type === 'fire') {
      this.shoot()
    } else if (event.type === 'bump') {
      this.cam.addShake(event.impact * 0.8)
      this.audio.play('hit')
      this.fx.burst(this.player.position, '#d8c39a', 10, 4)
    } else if (event.type === 'reload') {
      this.audio.play('reload')
      this.hooks.banner(this.hooks.t('hud.reloading'))
    } else if (event.type === 'reloadComplete') {
      this.audio.play('reloadComplete')
      this.hooks.banner(this.hooks.t('hud.reloaded'))
    }
  }

  private shoot(): void {
    const player = this.player
    const cam = this.cam
    if (!player || !cam) return
    const origin = cam.camera.getWorldPosition(new THREE.Vector3())
    const forward = cam.camera.getWorldDirection(new THREE.Vector3())
    const dir = applySpread(forward, CONFIG.weapon.spread)
    const range = this.loadout.range

    cam.addKick()
    player.addRecoil(CONFIG.camera.recoil)
    this.audio.play('shot')

    // Dünya geometrisi: duvarların arkasındaki düşmanları vurmayı engeller.
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z }
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z }
    const worldHit = this.physics.world.castRay(this.ray, range, true, undefined, undefined, player.collider)
    const worldDist = worldHit ? worldHit.timeOfImpact : Infinity

    let best: { enemy: Enemy; dist: number } | null = null
    for (const enemy of this.enemies.list) {
      const t = raySphere(origin, dir, enemy.pos, 1.15 * enemy.spec.scale)
      if (t !== null && t < worldDist && (!best || t < best.dist)) best = { enemy, dist: t }
    }

    const end = origin.clone().addScaledVector(dir, Math.min(best?.dist ?? worldDist, range))
    this.tracers.spawn(origin.clone().addScaledVector(dir, 1.1), dir, '#ffd35c', 360, 0.42)

    if (this.online) {
      this.onlineHandlers?.fire(origin, dir)
      return
    }

    if (best) {
      const dead = this.enemies.damage(best.enemy, CONFIG.weapon.damage)
      this.fx.burst(end, '#ffd35c', 8, 5)
      this.audio.play('hit')
      const hit = registerHit(this.run)
      this.run = hit.state
      this.hooks.popup(`+${hit.credits}`, this.project(end), 'score')
      if (dead) this.killEnemy(best.enemy)
    } else if (worldHit && worldDist < range) {
      this.fx.burst(end, '#c9b48a', 6, 3)
    }
  }

  private killEnemy(enemy: Enemy): void {
    const credits = Math.round(ENEMY_TYPES[enemy.spec.type].credits * (1 + (this.run.wave - 1) * 0.08))
    const result = registerKill(this.run, ENEMY_TYPES[enemy.spec.type].credits)
    this.run = result.state
    this.enemies.remove(enemy)
    this.fx.burst(enemy.pos, '#ff8a3c', 40, 9)
    this.fx.burst(enemy.pos, '#ffe08a', 18, 6)
    this.audio.play('kill')
    this.hooks.popup(`+${credits}`, this.project(enemy.pos), 'kill')
    this.hooks.kill(this.hooks.t('hud.kill', { name: enemy.spec.label }))
    if (this.cam) this.cam.addShake(0.25)
    if (result.waveCleared) this.audio.play('wave')
  }

  private onEnemyFire(shot: EnemyFire, playerPos: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(playerPos, shot.from).normalize()
    const hit = Math.random() < shot.hitChance
    const aim = hit ? playerPos.clone() : playerPos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 16))
    const shotDir = new THREE.Vector3().subVectors(aim, shot.from).normalize()
    this.tracers.spawn(shot.from, shotDir, '#ff6a3d', 300, 0.5)
    this.audio.play('hit')
    if (!hit || this.invuln > 0) return

    const result = damagePlayer(this.run)
    this.run = result.state
    this.invuln = CONFIG.drone.invulnerable
    this.sinceDamage = 0
    this.audio.play('hurt')
    this.hooks.hurt()
    this.hooks.popup(`-1`, this.project(playerPos), 'hurt')
    if (this.cam) this.cam.addShake(0.85)
    this.fx.burst(playerPos, '#ff4d3d', 16, 5)
    void dir
  }

  private updateWaves(dt: number, playerPos: THREE.Vector3): void {
    if (this.run.wavePhase !== 'active') return
    this.spawnTimer -= dt
    const alive = this.enemies.list.length
    const remaining = this.run.waveTotal - this.spawnedThisWave
    if (remaining <= 0 || alive >= CONFIG.waves.maxAlive || this.spawnTimer > 0) return
    this.spawnTimer = 1.1
    this.spawnEnemy(this.pickType(this.run.wave), playerPos)
    this.spawnedThisWave += 1
  }

  private pickType(wave: number): EnemyType {
    const r = Math.random()
    if (wave >= 4 && r < 0.24) return 'keskin'
    if (wave >= 2 && r < 0.48) return 'agir'
    if (wave >= 3 && r < 0.62) return 'keskin'
    return 'hafif'
  }

  private spawnEnemy(type: EnemyType, playerPos: THREE.Vector3): void {
    const candidates = this.arena.spawnPoints.filter(p => p.distanceTo(playerPos) > 70)
    const pool = candidates.length ? candidates : this.arena.spawnPoints
    const at = pool[Math.floor(Math.random() * pool.length)].clone()
    at.y = Math.max(18, Math.min(CONFIG.flight.ceiling - 20, at.y + (Math.random() - 0.5) * 18))
    this.enemies.spawn(type, at)
  }

  private updateHints(dt: number): void {
    if (this.hintStage >= 3) return
    this.hintTimer -= dt
    if (this.hintTimer > 0) return
    if (this.hintStage === 0) {
      this.hintStage = 1
      this.hintTimer = 9
      this.hooks.hint(this.hooks.t(this.input.method === 'touch' ? 'hint.fireTouch' : 'hint.fire'))
    } else if (this.hintStage === 1) {
      this.hintStage = 2
      this.hintTimer = 9
      this.hooks.hint(this.hooks.t('hint.reload'))
    } else {
      this.hintStage = 3
      this.hooks.hint(null)
    }
  }

  /** Dünya noktasını ekran koordinatına çevirir (popup'lar için). */
  project(world: THREE.Vector3): { x: number; y: number } {
    const camera = this.camera
    const v = this.tmp.copy(world).project(camera)
    const canvas = this.renderer.canvas
    return { x: ((v.x + 1) / 2) * canvas.clientWidth, y: ((1 - v.y) / 2) * canvas.clientHeight }
  }
}

void waveEnemyCount
