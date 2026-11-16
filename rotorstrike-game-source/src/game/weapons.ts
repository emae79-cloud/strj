import * as THREE from 'three'

type Tracer = { pos: THREE.Vector3; dir: THREE.Vector3; speed: number; life: number; max: number; color: THREE.Color; width: number; length: number }

const MAX = 160
const dummy = new THREE.Object3D()
const quat = new THREE.Quaternion()
const up = new THREE.Vector3(0, 0, 1)

/**
 * İz mermileri: tek InstancedMesh üzerinde havuzlanmış, ömürlü ve renkli çizgiler.
 * Oyuncu ateşi sıcak sarı, düşman ateşi kırmızı-turuncudur.
 */
export class Tracers {
  readonly mesh: THREE.InstancedMesh
  private tracers: Tracer[] = []

  constructor() {
    const geo = new THREE.BoxGeometry(0.075, 0.075, 2.6)
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: 0.95 })
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.setColorAt(0, new THREE.Color())
  }

  spawn(from: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation, speed = 320, life = 0.55, width = 1, length = 1): void {
    if (this.tracers.length >= MAX) this.tracers.shift()
    this.tracers.push({
      pos: from.clone(),
      dir: dir.clone().normalize(),
      speed,
      life,
      max: life,
      color: new THREE.Color(color),
      width,
      length,
    })
  }

  update(dt: number): void {
    this.tracers = this.tracers.filter(t => (t.life -= dt) > 0)
    for (const [i, t] of this.tracers.entries()) {
      t.pos.addScaledVector(t.dir, t.speed * dt)
      const k = Math.max(0.15, t.life / t.max)
      dummy.position.copy(t.pos)
      quat.setFromUnitVectors(up, t.dir)
      dummy.quaternion.copy(quat)
      dummy.scale.set(k * t.width, k * t.width, t.length)
      dummy.updateMatrix()
      this.mesh.setMatrixAt(i, dummy.matrix)
      this.mesh.setColorAt(i, t.color)
    }
    this.mesh.count = this.tracers.length
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  clear(): void {
    this.tracers = []
    this.mesh.count = 0
  }
}

/**
 * Işın–küre kesişimi. `dir` birim vektör olmalı; kesişim yoksa `null`, varsa mesafe döner.
 * Saf fonksiyon: birim testleriyle doğrulanır.
 */
export function raySphere(origin: THREE.Vector3, dir: THREE.Vector3, center: THREE.Vector3, radius: number): number | null {
  const oc = new THREE.Vector3().subVectors(origin, center)
  const b = oc.dot(dir)
  const c = oc.lengthSq() - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const sq = Math.sqrt(disc)
  const t1 = -b - sq
  const t2 = -b + sq
  if (t1 >= 0) return t1
  if (t2 >= 0) return t2
  return null
}

/** Yayılım uygulanmış yön üretir (kamera uzayında küçük sapma). */
export function applySpread(dir: THREE.Vector3, spread: number, random = Math.random): THREE.Vector3 {
  if (spread <= 0) return dir.clone()
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
  right.normalize()
  const up = new THREE.Vector3().crossVectors(right, dir).normalize()
  const a = random() * Math.PI * 2
  const r = Math.sqrt(random()) * spread
  return dir
    .clone()
    .addScaledVector(right, Math.cos(a) * r)
    .addScaledVector(up, Math.sin(a) * r)
    .normalize()
}
