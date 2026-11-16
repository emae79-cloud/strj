import * as THREE from 'three'
import { CONFIG } from './config'
import { buildDrone, type DroneVisual } from './models'

export type EnemyType = 'hafif' | 'agir' | 'keskin'

export type EnemySpec = {
  type: EnemyType
  label: string
  frame: 'scout' | 'interceptor' | 'bastion' | 'gunship' | 'strike' | 'phantom'
  palette: { body: string; accent: string; glass: string }
  speed: number
  accel: number
  /** Tercih ettiği çatışma mesafesi (m). */
  range: number
  fireCooldown: number
  /** Genel isabetliliğe çarpan. */
  accuracy: number
  credits: number
  scale: number
}

export const ENEMY_TYPES: Record<EnemyType, EnemySpec> = {
  hafif: {
    type: 'hafif',
    label: 'HAFİF',
    frame: 'strike',
    palette: { body: '#463a3a', accent: '#ff3b30', glass: '#1a1212' },
    speed: 30,
    accel: 30,
    range: 30,
    fireCooldown: 1.7,
    accuracy: 0.55,
    credits: 120,
    scale: 0.95,
  },
  agir: {
    type: 'agir',
    label: 'AĞIR',
    frame: 'gunship',
    palette: { body: '#3b4046', accent: '#ff7a2b', glass: '#14181c' },
    speed: 21,
    accel: 20,
    range: 26,
    fireCooldown: 1.05,
    accuracy: 0.78,
    credits: 200,
    scale: 1.18,
  },
  keskin: {
    type: 'keskin',
    label: 'KESKİN NİŞANCI',
    frame: 'interceptor',
    palette: { body: '#2b3138', accent: '#ffd23f', glass: '#101418' },
    speed: 27,
    accel: 24,
    range: 72,
    fireCooldown: 2.6,
    accuracy: 1.25,
    credits: 260,
    scale: 1.05,
  },
}

export type Enemy = {
  spec: EnemySpec
  hp: number
  maxHp: number
  root: THREE.Group
  visual: DroneVisual
  pips: THREE.Mesh[]
  pos: THREE.Vector3
  vel: THREE.Vector3
  yaw: number
  pitch: number
  fireCd: number
  evade: number
  orbitDir: 1 | -1
  phase: number
  hitFlash: number
  age: number
}

export type EnemyFire = { from: THREE.Vector3; hitChance: number; enemy: Enemy }

/**
 * Düşman dronları: yörünge/kovalama/kaçınma davranışı, sürü ayrışması ve görüş açısına bağlı
 * ateş. Hareket saf vektör matematiğiyle yürür; çarpışma çözümü yalnızca zemin/tavan sınırıdır.
 */
export class Enemies {
  readonly group = new THREE.Group()
  readonly list: Enemy[] = []

  spawn(type: EnemyType, at: THREE.Vector3): Enemy {
    const spec = ENEMY_TYPES[type]
    const root = new THREE.Group()
    const visual = buildDrone(spec.frame, spec.palette, { enemy: true, scale: spec.scale })
    root.add(visual.root)
    root.position.copy(at)

    // Dört can göstergesi: düşmanın üstünde küçük çentikler.
    const pips: THREE.Mesh[] = []
    const pipGroup = new THREE.Group()
    for (let i = 0; i < CONFIG.drone.hp; i += 1) {
      const pip = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.05, 0.02),
        new THREE.MeshBasicMaterial({ color: '#ff4b3a', toneMapped: false }),
      )
      pip.position.set((i - (CONFIG.drone.hp - 1) / 2) * 0.2, 0, 0)
      pipGroup.add(pip)
      pips.push(pip)
    }
    pipGroup.position.y = 0.85
    root.add(pipGroup)
    this.group.add(root)

    const enemy: Enemy = {
      spec,
      hp: CONFIG.drone.hp,
      maxHp: CONFIG.drone.hp,
      root,
      visual,
      pips,
      pos: at.clone(),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      fireCd: 0.6 + Math.random() * spec.fireCooldown,
      evade: 0,
      orbitDir: Math.random() > 0.5 ? 1 : -1,
      phase: Math.random() * Math.PI * 2,
      hitFlash: 0,
      age: 0,
    }
    this.list.push(enemy)
    return enemy
  }

  clear(): void {
    for (const e of this.list) this.group.remove(e.root)
    this.list.length = 0
  }

  /** Hasar uygula; düşman düştüyse `true`. */
  damage(enemy: Enemy, amount = 1): boolean {
    enemy.hp -= amount
    enemy.hitFlash = 0.3
    enemy.evade = 1.4
    enemy.orbitDir = enemy.orbitDir === 1 ? -1 : 1
    return enemy.hp <= 0
  }

  remove(enemy: Enemy): void {
    this.group.remove(enemy.root)
    const i = this.list.indexOf(enemy)
    if (i >= 0) this.list.splice(i, 1)
  }

  step(dt: number, playerPos: THREE.Vector3, playerVel: THREE.Vector3, wave: number, out: EnemyFire[]): void {
    const accuracy = Math.min(CONFIG.ai.accuracyMax, CONFIG.ai.accuracy + (wave - 1) * CONFIG.ai.accuracyPerWave)
    for (const e of this.list) {
      e.age += dt
      e.hitFlash = Math.max(0, e.hitFlash - dt)
      e.fireCd = Math.max(0, e.fireCd - dt)
      e.evade = Math.max(0, e.evade - dt)

      const toPlayer = new THREE.Vector3().subVectors(playerPos, e.pos)
      const dist = toPlayer.length()
      const dirToPlayer = toPlayer.clone().normalize()

      // Tercih edilen mesafeyi koru, etrafında dön.
      const radial = THREE.MathUtils.clamp((dist - e.spec.range) / 14, -1, 1)
      const tangent = new THREE.Vector3().crossVectors(dirToPlayer, new THREE.Vector3(0, 1, 0))
      if (tangent.lengthSq() < 1e-4) tangent.set(1, 0, 0)
      tangent.normalize().multiplyScalar(e.orbitDir)

      const desired = new THREE.Vector3()
        .addScaledVector(dirToPlayer, radial * 0.9)
        .addScaledVector(tangent, 0.85)
        .addScaledVector(new THREE.Vector3(0, 1, 0), Math.sin(e.age * 0.8 + e.phase) * 0.35)

      // Kaçınma: vurulunca yana kaçar ve biraz uzaklaşır.
      if (e.evade > 0) desired.addScaledVector(tangent, 1.1).addScaledVector(dirToPlayer, -0.6)

      // Sürü ayrışması.
      for (const other of this.list) {
        if (other === e) continue
        const away = new THREE.Vector3().subVectors(e.pos, other.pos)
        const d2 = away.lengthSq()
        if (d2 > 1e-4 && d2 < 100) desired.addScaledVector(away.normalize(), (10 - Math.sqrt(d2)) * 0.18)
      }

      // Zemin ve tavan kaçınması.
      if (e.pos.y < 16) desired.y += (16 - e.pos.y) * 0.12
      if (e.pos.y > CONFIG.flight.ceiling - 12) desired.y -= 1.4

      if (desired.lengthSq() > 1e-6) desired.normalize()
      const targetVel = desired.multiplyScalar(e.spec.speed * (e.evade > 0 ? 1.25 : 1))
      e.vel.lerp(targetVel, 1 - Math.exp(-(e.spec.accel / 6) * dt))
      e.pos.addScaledVector(e.vel, dt)

      // Sınırlar.
      const bound = 235
      e.pos.x = THREE.MathUtils.clamp(e.pos.x, -bound, bound)
      e.pos.z = THREE.MathUtils.clamp(e.pos.z, -bound, bound)
      e.pos.y = THREE.MathUtils.clamp(e.pos.y, 9, CONFIG.flight.ceiling - 4)

      // Oyuncuya dönük bakış.
      const targetYaw = Math.atan2(-dirToPlayer.x, -dirToPlayer.z)
      const targetPitch = Math.asin(THREE.MathUtils.clamp(dirToPlayer.y, -1, 1))
      e.yaw = dampAngle(e.yaw, targetYaw, 5, dt)
      e.pitch = THREE.MathUtils.damp(e.pitch, targetPitch, 5, dt)

      // Ateş: menzil ve görüş açısı içindeyse.
      const aimDot = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)).dot(new THREE.Vector3(dirToPlayer.x, 0, dirToPlayer.z).normalize())
      const inRange = dist < e.spec.range * 1.9
      const aligned = aimDot > Math.cos(CONFIG.ai.aimTolerance + 0.12)
      if (inRange && aligned && e.fireCd <= 0 && e.age > 1.2) {
        e.fireCd = e.spec.fireCooldown * (0.85 + Math.random() * 0.3)
        const distFactor = THREE.MathUtils.clamp(1 - dist / (e.spec.range * 2.4), 0.25, 1)
        const speedFactor = 1 / (1 + playerVel.length() * 0.012)
        const hitChance = THREE.MathUtils.clamp(accuracy * e.spec.accuracy * distFactor * speedFactor, 0.04, 0.85)
        out.push({ from: e.visual.muzzle.getWorldPosition(new THREE.Vector3()), hitChance, enemy: e })
      }
    }
  }

  /** Kamera yaw'ına göre can çentiklerini ve pervane dönüşünü günceller. */
  animate(frameSeconds: number, cameraYaw: number, time: number): void {
    for (const e of this.list) {
      e.root.position.copy(e.pos)
      e.root.rotation.set(0, e.yaw, 0)
      e.visual.root.rotation.set(-e.pitch * 0.35, 0, Math.sin(time * 2 + e.phase) * 0.05)
      for (const r of e.visual.rotors) r.rotation.y += frameSeconds * 30
      const pipGroup = e.pips[0].parent as THREE.Group
      pipGroup.rotation.y = cameraYaw - e.yaw
      for (const [i, pip] of e.pips.entries()) pip.visible = i < e.hp
      const flash = e.hitFlash > 0 ? 3.4 : 1.1
      for (const light of e.visual.lights) light.emissiveIntensity = flash
    }
  }
}

function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  let delta = (to - from) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  if (delta < -Math.PI) delta += Math.PI * 2
  return from + delta * (1 - Math.exp(-lambda * dt))
}
