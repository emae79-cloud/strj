import * as THREE from 'three'
import { RAPIER, type Physics } from '../engine/physics'
import { CONFIG } from './config'
import type { Loadout } from './hangar'
import { buildDrone, type DroneVisual } from './models'
import type { DroneSpec } from './hangar'

export type FlightIntent = {
  /** -1..1 yatay itki (sağ pozitif). */
  moveX: number
  /** -1..1 ileri itki (ileri pozitif). */
  moveY: number
  /** -1..1 dikey itki (yukarı pozitif). */
  climb: number
  fire: boolean
  stabilize: boolean
}

export type FlightEvent = { type: 'fire' } | { type: 'bump'; impact: number } | { type: 'reload' } | { type: 'reloadComplete' }

const UP = new THREE.Vector3(0, 1, 0)

/**
 * Oyuncu dronu: itki + atalet + sürüklenme modeli, KinematicCharacterController ile çözülen
 * çarpışmalar ve otomatik şarjör/doldurma. Bakış yaw/pitch'i doğrudan uçuş yönünü belirler.
 */
export class PlayerDrone {
  readonly root = new THREE.Group()
  readonly visual: DroneVisual
  readonly body: RAPIER.RigidBody
  readonly collider: RAPIER.Collider
  readonly velocity = new THREE.Vector3()
  yaw = 0
  pitch = 0
  ammo = CONFIG.weapon.magazineSize
  reloadRemaining = 0
  /** Görsel yatma açısı (radyan). */
  roll = 0
  private readonly controller: RAPIER.KinematicCharacterController
  private fireCooldown = 0
  private bank = 0
  private pitchVisual = 0
  private loadout: Loadout

  constructor(private readonly physics: Physics, spawn: THREE.Vector3, spec: DroneSpec, loadout: Loadout) {
    const world = physics.world
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z))
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.ball(CONFIG.drone.radius).setFriction(0).setRestitution(0.1),
      this.body,
    )
    this.controller = world.createCharacterController(0.02)
    this.controller.enableSnapToGround(0)
    this.controller.setMaxSlopeClimbAngle(THREE.MathUtils.degToRad(70))
    this.controller.setMinSlopeSlideAngle(THREE.MathUtils.degToRad(50))

    this.loadout = loadout
    this.root.position.copy(spawn)
    this.visual = buildDrone(spec.frame, spec.palette)
    this.root.add(this.visual.root)
    physics.bind(this.body, this.root)
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation()
    return new THREE.Vector3(t.x, t.y, t.z)
  }

  get speed(): number {
    return this.velocity.length()
  }

  setLoadout(loadout: Loadout): void {
    this.loadout = loadout
  }

  /** Bakış yönü birim vektörü (kamera -Z ekseni). */
  forward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch)
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp)
  }

  /** Sağ yön (yatay düzlemde). */
  right(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx
    this.pitch -= dy
    // Sınırsız pitch, mouse'u tam tur çevirince kameranın/dronun ters dönmesine izin verir.
    if (Math.abs(this.pitch) > Math.PI * 64) this.pitch %= Math.PI * 2
    if (Math.abs(this.yaw) > Math.PI * 64) this.yaw %= Math.PI * 2
  }

  /** Ateş geri tepmesi: bakışı hafifçe yukarı iter. */
  addRecoil(amount: number): void {
    this.pitch += amount
  }

  step(dt: number, intent: FlightIntent, events: FlightEvent[]): void {
    const cfg = CONFIG.flight
    const forward = this.forward()
    const right = this.right()
    const thrust = new THREE.Vector3()
      .addScaledVector(forward, intent.moveY * this.loadout.accel)
      .addScaledVector(right, intent.moveX * cfg.lateralAccel * (intent.moveY < -0.1 ? 1.2 : 1))
      .addScaledVector(UP, intent.climb * this.loadout.vertical)

    this.velocity.addScaledVector(thrust, dt)
    // Stabilizasyon açıkken yerçekimi büyük ölçüde telafi edilir; kapalıyken tam etki.
    this.velocity.y += cfg.gravity * dt * (intent.stabilize ? 0.22 : 1)

    const dragK = intent.stabilize ? (this.loadout.accel * 0.95) / this.loadout.maxSpeed : cfg.driftDrag
    const damp = Math.exp(-dragK * dt)
    this.velocity.multiplyScalar(damp)

    const horizontal = Math.hypot(this.velocity.x, this.velocity.z)
    if (horizontal > this.loadout.maxSpeed) {
      const k = this.loadout.maxSpeed / horizontal
      this.velocity.x *= k
      this.velocity.z *= k
    }
    this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -this.loadout.maxSpeed * 0.8, this.loadout.maxSpeed * 0.8)

    const desired = this.velocity.clone().multiplyScalar(dt)
    this.controller.computeColliderMovement(this.collider, desired)
    const moved = this.controller.computedMovement()
    const sq = (v: { x: number; y: number; z: number }) => v.x * v.x + v.y * v.y + v.z * v.z
    const blocked = sq(desired) > 1e-8 && sq(moved) < sq(desired) * 0.45
    if (blocked) {
      const impact = this.velocity.length()
      this.velocity.multiplyScalar(0.2)
      if (impact > 6) events.push({ type: 'bump', impact: Math.min(1, impact / 30) })
    }

    const cur = this.body.translation()
    let next = { x: cur.x + moved.x, y: cur.y + moved.y, z: cur.z + moved.z }
    if (next.y < cfg.floor + CONFIG.drone.radius) {
      next = { ...next, y: cfg.floor + CONFIG.drone.radius }
      this.velocity.y = Math.max(0, this.velocity.y)
    }
    if (next.y > cfg.ceiling) {
      next = { ...next, y: cfg.ceiling }
      this.velocity.y = Math.min(0, this.velocity.y)
    }
    this.body.setNextKinematicTranslation(next)

    // Görsel yatma: yana itki ve yatay hız gövdeyi yatırır.
    const lateral = intent.moveX * 0.42 + THREE.MathUtils.clamp(this.velocity.dot(right) / 40, -0.35, 0.35)
    this.bank = THREE.MathUtils.damp(this.bank, lateral, 6, dt)
    const forwardSpeed = this.velocity.dot(forward)
    this.pitchVisual = THREE.MathUtils.damp(this.pitchVisual, THREE.MathUtils.clamp(forwardSpeed / 60, -0.3, 0.3), 5, dt)
    this.roll = this.bank * cfg.bankGain

    // Otomatik silah: ölçülü seri atış, 20 mermi ve sabit beş saniyelik yeniden doldurma.
    const w = CONFIG.weapon
    this.fireCooldown = Math.max(0, this.fireCooldown - dt)
    if (this.reloadRemaining > 0) {
      this.reloadRemaining = Math.max(0, this.reloadRemaining - dt)
      if (this.reloadRemaining === 0) {
        this.ammo = w.magazineSize
        events.push({ type: 'reloadComplete' })
      }
    }
    if (intent.fire && this.reloadRemaining <= 0 && this.fireCooldown <= 0 && this.ammo > 0) {
      this.fireCooldown = 1 / Math.min(this.loadout.fireRate, w.maxFireRate)
      this.ammo -= 1
      events.push({ type: 'fire' })
      if (this.ammo === 0) {
        this.reloadRemaining = w.reloadSeconds
        events.push({ type: 'reload' })
      }
    }
  }

  teleport(to: THREE.Vector3, yaw = this.yaw, pitch = 0): void {
    this.body.setTranslation(to, true)
    this.body.setNextKinematicTranslation(to)
    this.velocity.set(0, 0, 0)
    this.yaw = yaw
    this.pitch = pitch
    this.ammo = CONFIG.weapon.magazineSize
    this.reloadRemaining = 0
    this.fireCooldown = 0
    this.root.position.copy(to)
    this.physics.snap(this.body)
  }

  /** Görsel animasyon: pervane dönüşü, gövde eğimi ve vurgu ışıkları. */
  animate(frameSeconds: number, time: number, thrust: number): void {
    this.root.rotation.set(0, this.yaw, 0)
    this.visual.root.rotation.set(this.pitchVisual * 0.6, 0, this.roll)
    const spin = 26 + thrust * 34
    for (const r of this.visual.rotors) r.rotation.y += frameSeconds * spin
    const pulse = 0.9 + Math.sin(time * 6) * 0.25
    for (const light of this.visual.lights) light.emissiveIntensity = pulse
  }
}
