import * as THREE from 'three'
import { CONFIG } from './config'
import type { DroneSpec } from './hangar'
import { buildCockpit } from './models'
import type { PlayerDrone } from './player'

/**
 * Gimbal birinci şahıs kamera: dronun burnunda, bakış yaw/pitch'ini izler, gövde yatışını
 * yumuşak biçimde katar. Kokpit parçaları (burun ve ön pervaneler) kameraya bağlıdır,
 * böylece oyuncu gerçekten bir drone'un içinden bakıyormuş gibi hisseder.
 */
export class CockpitCamera {
  readonly camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, 1, 0.05, 2400)
  private readonly cockpit = new THREE.Group()
  private shake = 0
  private kick = 0
  private readonly cockpitParts: ReturnType<typeof buildCockpit>
  private readonly basePosition = new THREE.Vector3(0, 0, 0)

  constructor(spec: DroneSpec) {
    this.cockpitParts = buildCockpit(spec.palette)
    this.cockpit.add(this.cockpitParts.group)
    this.camera.add(this.cockpit)
    this.camera.rotation.order = 'YXZ'
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount)
  }

  /** Ateş geri tepmesi: kamera kısa süre geriye/yan kayar. */
  addKick(): void {
    this.kick = Math.min(1, this.kick + 0.45)
  }

  update(player: PlayerDrone, frameSeconds: number, reducedMotion: boolean): void {
    const cam = this.camera
    if (cam.fov !== CONFIG.camera.fov) {
      cam.fov = CONFIG.camera.fov
      cam.updateProjectionMatrix()
    }

    // Kamera, dronun burnunun hemen üstünde; hafif yay ile takip eder.
    const forward = player.forward()
    const pos = player.position.addScaledVector(forward, 0.12)
    this.basePosition.copy(pos)
    pos.y += 0.16

    if (this.shake > 0 && !reducedMotion) {
      const s = this.shake * this.shake * 0.16
      pos.x += (Math.random() - 0.5) * s
      pos.y += (Math.random() - 0.5) * s
      pos.z += (Math.random() - 0.5) * s
    }
    cam.position.copy(pos)
    this.kick = THREE.MathUtils.damp(this.kick, 0, 12, frameSeconds)
    this.shake = Math.max(0, this.shake - frameSeconds * 2.2)

    // Bakış: yaw/pitch + yatış (roll) + geri tepme.
    const recoil = this.kick * 0.035
    cam.rotation.set(player.pitch + recoil, player.yaw, player.roll * 0.55)
    cam.position.addScaledVector(forward, -this.kick * 0.06)

    // Dikey ekranlarda kokpit burnu görüşü fazla kapatmasın.
    const cockpitScale = cam.aspect < 0.95 ? 0.62 : 1
    if (this.cockpit.scale.x !== cockpitScale) this.cockpit.scale.setScalar(cockpitScale)

    // Kokpit ön pervaneleri.
    for (const rotor of this.cockpitParts.rotors) rotor.rotation.y += frameSeconds * 42
  }
}
