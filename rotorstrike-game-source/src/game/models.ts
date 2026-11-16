import * as THREE from 'three'
import type { DroneSpec } from './hangar'

/**
 * Prosedürel kompakt kamera dronu: katlanır kollar, motorlar, pervane diskleri ve gimbal kamera.
 * Görünür silah/namlu yoktur; atış için ayrı bir görünmez referans noktası kullanılır. Bütün
 * parçalar paylaşılabilir geometrilerden üretilir, böylece yedi
 * düşman aynı sahnede düşük çizim yüküyle kalır. Burun yerel -Z yönündedir.
 */
export type DroneVisual = {
  root: THREE.Group
  /** Dönen pervane grupları. */
  rotors: THREE.Object3D[]
  /** Görünmez atış referans noktası (yerel uzayda). */
  muzzle: THREE.Object3D
  /** Vurgu ışıkları — hasar/vurgu için parlaklığı değiştirilebilir. */
  lights: THREE.MeshStandardMaterial[]
}

const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material>()

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `b${w},${h},${d}`
  let g = geoCache.get(key)
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d)
    geoCache.set(key, g)
  }
  return g
}

function cyl(r1: number, r2: number, h: number, seg = 10): THREE.BufferGeometry {
  const key = `c${r1},${r2},${h},${seg}`
  let g = geoCache.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(r1, r2, h, seg)
    geoCache.set(key, g)
  }
  return g
}

function fuselage(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `f${w},${h},${d}`
  let g = geoCache.get(key)
  if (!g) {
    const shape = new THREE.Shape()
    shape.moveTo(0, -d * 0.53)
    shape.lineTo(w * 0.31, -d * 0.43)
    shape.lineTo(w * 0.48, -d * 0.16)
    shape.lineTo(w * 0.44, d * 0.34)
    shape.lineTo(w * 0.28, d * 0.49)
    shape.lineTo(-w * 0.28, d * 0.49)
    shape.lineTo(-w * 0.44, d * 0.34)
    shape.lineTo(-w * 0.48, -d * 0.16)
    shape.lineTo(-w * 0.31, -d * 0.43)
    shape.closePath()
    g = new THREE.ExtrudeGeometry(shape, {
      depth: h,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: h * 0.12,
      bevelSize: Math.min(w, h) * 0.12,
      bevelSegments: 2,
    })
    g.rotateX(Math.PI / 2)
    g.translate(0, h * 0.5, 0)
    g.computeVertexNormals()
    geoCache.set(key, g)
  }
  return g
}

function standard(color: string, roughness: number, metalness: number, emissive?: string, intensity = 0): THREE.MeshStandardMaterial {
  const key = `s${color},${roughness},${metalness},${emissive ?? ''},${intensity}`
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive: emissive ? new THREE.Color(emissive) : new THREE.Color('#000000'),
      emissiveIntensity: intensity,
    })
    matCache.set(key, m)
  }
  return m
}

type Palette = { body: string; accent: string; glass: string }

type FrameSpec = {
  armLength: number
  armWidth: number
  bodyW: number
  bodyH: number
  bodyD: number
  rotorRadius: number
  rotorBlades: number
  /** Kolların öne/arkaya kayması (süpürme). */
  sweep: number
  /** Kolların yukarı açısı. */
  dihedral: number
}

const FRAMES: Record<DroneSpec['frame'], FrameSpec> = {
  scout: { armLength: 0.62, armWidth: 0.085, bodyW: 0.42, bodyH: 0.17, bodyD: 0.86, rotorRadius: 0.26, rotorBlades: 2, sweep: 0, dihedral: 0.04 },
  interceptor: { armLength: 0.66, armWidth: 0.075, bodyW: 0.38, bodyH: 0.15, bodyD: 0.91, rotorRadius: 0.25, rotorBlades: 2, sweep: 0.12, dihedral: 0.02 },
  bastion: { armLength: 0.64, armWidth: 0.105, bodyW: 0.48, bodyH: 0.2, bodyD: 0.88, rotorRadius: 0.28, rotorBlades: 2, sweep: 0, dihedral: 0.05 },
  gunship: { armLength: 0.65, armWidth: 0.1, bodyW: 0.46, bodyH: 0.19, bodyD: 0.9, rotorRadius: 0.27, rotorBlades: 2, sweep: 0.04, dihedral: 0.04 },
  strike: { armLength: 0.68, armWidth: 0.07, bodyW: 0.36, bodyH: 0.14, bodyD: 0.82, rotorRadius: 0.25, rotorBlades: 2, sweep: -0.08, dihedral: 0.07 },
  phantom: { armLength: 0.66, armWidth: 0.085, bodyW: 0.4, bodyH: 0.16, bodyD: 0.88, rotorRadius: 0.26, rotorBlades: 2, sweep: 0.06, dihedral: 0.03 },
}

/** Dört rotorlu drone modeli üretir. */
export function buildDrone(frame: DroneSpec['frame'], palette: Palette, opts: { scale?: number; enemy?: boolean } = {}): DroneVisual {
  const f = FRAMES[frame]
  const root = new THREE.Group()
  const bodyMat = standard(palette.body, 0.62, 0.28)
  const darkMat = standard('#15181c', 0.5, 0.45)
  const metalMat = standard('#8b939a', 0.35, 0.85)
  const accentMat = standard(palette.accent, 0.45, 0.2, palette.accent, 1.1)
  const glassMat = standard(palette.glass, 0.15, 0.7, palette.accent, 0.12)
  const rotorMat = new THREE.MeshBasicMaterial({ color: '#aeb7bd', transparent: true, opacity: 0.16, depthWrite: false })

  // Alçak, pah kırılmış kamera drone gövdesi ve üstteki hafif kabuk.
  const plate = new THREE.Mesh(fuselage(f.bodyW, f.bodyH, f.bodyD), bodyMat)
  plate.castShadow = true
  root.add(plate)

  const spine = new THREE.Mesh(box(f.bodyW * 0.55, f.bodyH * 0.8, f.bodyD * 0.9), darkMat)
  spine.position.y = f.bodyH * 0.72
  spine.castShadow = true
  root.add(spine)

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(f.bodyW * 0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat)
  canopy.position.set(0, f.bodyH * 0.5, -f.bodyD * 0.18)
  canopy.scale.set(1, 0.75, 1.55)
  root.add(canopy)

  const noseTrim = new THREE.Mesh(box(f.bodyW * 0.3, 0.025, 0.035), accentMat)
  noseTrim.position.set(0, -f.bodyH * 0.08, -f.bodyD * 0.38)
  root.add(noseTrim)

  // Gimbal kamera (burun altı).
  const gimbal = new THREE.Group()
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), darkMat)
  const lens = new THREE.Mesh(cyl(0.038, 0.042, 0.04, 10), standard('#0a0c0e', 0.2, 0.6, palette.accent, 0.6))
  lens.rotation.x = Math.PI / 2
  lens.position.z = -0.07
  gimbal.add(ball, lens)
  gimbal.position.set(0, -f.bodyH * 0.75, -f.bodyD * 0.32)
  root.add(gimbal)

  // Kollar, motorlar, pervaneler.
  const rotors: THREE.Object3D[] = []
  const armPositions: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
  for (const [sx, sz] of armPositions) {
    const arm = new THREE.Mesh(box(f.armWidth, f.armWidth * 0.72, f.armLength), darkMat)
    const angle = Math.atan2(sx, sz)
    arm.position.set(sx * (f.bodyW * 0.35 + f.armLength * 0.4), 0, sz * (f.bodyD * 0.2 + f.armLength * 0.35) + sz * f.sweep)
    arm.rotation.set(0, angle, 0)
    arm.rotateX(-f.dihedral * sz)
    arm.castShadow = true
    root.add(arm)

    // Katlanır kol pimi ve kolun üstündeki değiştirilebilir karbon kapağı.
    const hinge = new THREE.Mesh(cyl(0.078, 0.078, 0.075, 12), metalMat)
    hinge.position.set(sx * f.bodyW * 0.39, 0.015, sz * f.bodyD * 0.17 + sz * f.sweep * 0.3)
    root.add(hinge)
    const hingeRing = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.008, 5, 14), accentMat)
    hingeRing.rotation.x = Math.PI / 2
    hingeRing.position.set(hinge.position.x, 0.056, hinge.position.z)
    root.add(hingeRing)
    const armShell = new THREE.Mesh(box(f.armWidth * 0.55, f.armWidth * 0.18, f.armLength * 0.78), bodyMat)
    armShell.position.copy(arm.position)
    armShell.position.y += f.armWidth * 0.42
    armShell.rotation.copy(arm.rotation)
    root.add(armShell)

    const motorX = arm.position.x + sx * f.armLength * 0.44
    const motorZ = arm.position.z + sz * f.armLength * 0.44
    const motorY = arm.position.y + f.dihedral * 0.32

    const motor = new THREE.Mesh(cyl(0.055, 0.062, 0.12, 10), metalMat)
    motor.position.set(motorX, motorY, motorZ)
    motor.castShadow = true
    root.add(motor)

    const led = new THREE.Mesh(box(0.045, 0.03, 0.045), accentMat)
    led.position.set(motorX, motorY - 0.075, motorZ)
    root.add(led)

    const rotor = new THREE.Group()
    rotor.position.set(motorX, motorY + 0.07, motorZ)
    for (let b = 0; b < f.rotorBlades; b += 1) {
      const blade = new THREE.Mesh(box(f.rotorRadius * 1.7, 0.012, 0.075), darkMat)
      blade.rotation.y = (b / f.rotorBlades) * Math.PI * 2
      rotor.add(blade)
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(f.rotorRadius * 0.92, 20), rotorMat)
    disc.rotation.x = -Math.PI / 2
    rotor.add(disc)
    root.add(rotor)
    rotors.push(rotor)
  }

  // Atış hesaplamaları için görünmez nokta; oyuncu ve düşmanlarda silah modeli çizilmez.
  const muzzle = new THREE.Group()
  muzzle.position.set(0, -f.bodyH * 0.25, -f.bodyD * 0.58)
  root.add(muzzle)

  // Kuyruk navigasyon ışığı (düşmanlarda kırmızı).
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), accentMat)
  tail.position.set(0, 0, f.bodyD * 0.5)
  root.add(tail)

  if (opts.enemy) {
    root.traverse(obj => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh && mesh.material === bodyMat) mesh.material = standard(palette.body, 0.7, 0.2)
    })
  }
  if (opts.scale) root.scale.setScalar(opts.scale)

  return { root, rotors, muzzle, lights: [accentMat] }
}

/**
 * Birinci şahıs kokpit: alt görüşte kompakt kamera drone burnu ve iki ön katlanır kol.
 * Parçalar ince tutulur; ufku kapatmaz ve hiçbir görünür silah/namlu içermez.
 * Kamera uzayında çağrılır; burun -Z yönündedir.
 */
export function buildCockpit(palette: Palette): { group: THREE.Group; rotors: THREE.Object3D[] } {
  const group = new THREE.Group()
  const bodyMat = standard(palette.body, 0.62, 0.28)
  const darkMat = standard('#2a3136', 0.55, 0.45)
  const accentMat = standard(palette.accent, 0.4, 0.2, palette.accent, 1.4)

  // Alçak gövde kabuğu, uçuş yönü şeridi ve kamera gimbali.
  const hood = new THREE.Mesh(fuselage(0.52, 0.1, 0.72), bodyMat)
  hood.position.set(0, -0.82, -1.16)
  hood.rotation.x = 0.04
  group.add(hood)

  const lip = new THREE.Mesh(box(0.54, 0.016, 0.03), accentMat)
  lip.position.set(0, -0.765, -0.82)
  group.add(lip)
  const spine = new THREE.Mesh(box(0.12, 0.03, 0.56), darkMat)
  spine.position.set(0, -0.758, -1.02)
  group.add(spine)

  const rotors: THREE.Object3D[] = []
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(box(0.055, 0.04, 0.56), darkMat)
    arm.position.set(sx * 0.43, -0.84, -1.03)
    arm.rotation.y = sx * 0.2
    group.add(arm)

    const hinge = new THREE.Mesh(cyl(0.07, 0.07, 0.06, 10), accentMat)
    hinge.position.set(sx * 0.25, -0.82, -0.94)
    group.add(hinge)

    const motor = new THREE.Mesh(cyl(0.075, 0.085, 0.08, 10), darkMat)
    motor.position.set(sx * 0.69, -0.84, -1.03)
    group.add(motor)

    const rotor = new THREE.Group()
    rotor.position.set(sx * 0.69, -0.785, -1.03)
    const blade = new THREE.Mesh(box(0.42, 0.009, 0.035), darkMat)
    rotor.add(blade)
    const crossBlade = new THREE.Mesh(box(0.42, 0.009, 0.035), darkMat)
    crossBlade.rotation.y = Math.PI / 2
    rotor.add(crossBlade)
    group.add(rotor)
    rotors.push(rotor)
  }

  const cameraHousing = new THREE.Mesh(new THREE.SphereGeometry(0.088, 14, 10), darkMat)
  cameraHousing.position.set(0, -0.9, -1.43)
  group.add(cameraHousing)
  const lens = new THREE.Mesh(cyl(0.038, 0.042, 0.045, 12), standard('#0a0c0e', 0.2, 0.6, palette.accent, 0.5))
  lens.rotation.x = Math.PI / 2
  lens.position.set(0, -0.9, -1.49)
  group.add(lens)

  // Kokpit hiç gölge düşürmesin: kamera içinde kalan parçalar.
  group.traverse(obj => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
    }
  })

  return { group, rotors }
}
