import * as THREE from 'three'
import type { Physics } from '../engine/physics'

import { asphaltTexture, concreteTexture, facadeTexture } from './textures'
/**
 * Savaş alanı: düzenli yollar, yüksek binalar, kanal-köprü ve park içeren modern şehir merkezi.
 * Geometri ilkel şekillerden ve deterministik rastgele üreticiden gelir; collider'lar görünen
 * mesh boyutlarıyla aynı yerden türetilir.
 */
export const ARENA = {
  /** Oyuncunun doğduğu nokta — şehir merkezine bakan iniş platformu. */
  spawn: new THREE.Vector3(0, 42, 96),
  ground: 0,
  /** Uçuş alanı sınırı (m). */
  bounds: 250,
}

export const PALETTE = {
  skyTop: new THREE.Color('#3478ad'),
  horizon: new THREE.Color('#a7b9c0'),
  concrete: new THREE.Color('#8d8a80'),
  concreteDark: new THREE.Color('#5c5a55'),
  metal: new THREE.Color('#7d858c'),
  accent: new THREE.Color('#ff6a2b'),
  teal: new THREE.Color('#3ad8c8'),
}

/** Mulberry32: küçük deterministik rastgele üretici. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const materials = new Map<string, THREE.Material>()
function mat(color: THREE.ColorRepresentation, roughness = 0.9, metalness = 0.05): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color)
  const key = `${c.getHexString()}:${roughness}:${metalness}`
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, roughness, metalness })
    materials.set(key, m)
  }
  return m
}

function glowMat(color: THREE.ColorRepresentation, intensity = 1.4): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color)
  const key = `glow:${c.getHexString()}:${intensity}`
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: intensity, roughness: 0.4 })
    materials.set(key, m)
  }
  return m
}

export class Arena {
  readonly scene = new THREE.Scene()
  readonly sun: THREE.DirectionalLight
  readonly spawn = ARENA.spawn.clone()
  /** Düşmanların doğabileceği açık hava noktaları. */
  readonly spawnPoints: THREE.Vector3[] = []
  private readonly dust: THREE.Points
  private readonly dustVel: Float32Array
  private readonly props: THREE.Object3D[] = []

  constructor(private readonly physics: Physics, shadowMapSize: number) {
    const random = rng(20261116)
    this.scene.background = PALETTE.horizon.clone()
    this.scene.fog = new THREE.Fog(PALETTE.horizon.clone(), 320, 1250)

    this.scene.add(this.makeSky())
    this.scene.add(new THREE.HemisphereLight('#d9eaff', '#9b7650', 0.95))
    this.sun = new THREE.DirectionalLight('#fff1d8', 3.2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize)
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -130
    cam.right = cam.top = 130
    cam.near = 1
    cam.far = 420
    this.sun.shadow.bias = -0.0006
    this.sun.shadow.normalBias = 0.06
    this.scene.add(this.sun, this.sun.target)

    this.addGround()
    this.addDistantSkyline(random)
    this.addCity(random)
    this.addCityLandmark()
    this.addCityInfrastructure()
    this.addStreetFurniture()
    this.addCityPark()
    this.addCityWaterfront()
    this.addProps(random)
    this.addBoundary()

    const dust = this.makeDust(random)
    this.dust = dust.points
    this.dustVel = dust.vel
    this.scene.add(this.dust)

    // Düşmanlar binaların arkasında değil, açık şehir yollarında doğar.
    const corridors: [number, number][] = [
      [-90, -25], [0, -25], [90, -25],
      [-150, -50], [-30, -50], [60, -50], [150, -50],
      [-90, -95], [0, -95], [90, -95],
      [-150, -145], [-30, -145], [60, -145], [150, -145],
      [-90, -235], [0, -235],
    ]
    for (const [x, z] of corridors) this.spawnPoints.push(new THREE.Vector3(x, 38 + random() * 34, z))
  }

  update(dt: number, focus: THREE.Vector3): void {
    // Gölge hacmi oyuncuyu izler.
    this.sun.position.set(focus.x + 90, focus.y + 150, focus.z + 60)
    this.sun.target.position.copy(focus)

    // Toz: hafif sürüklenme, alan dışına çıkanı geri sar.
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i += 1) {
      let x = pos.getX(i) + this.dustVel[i * 3] * dt
      let y = pos.getY(i) + this.dustVel[i * 3 + 1] * dt
      let z = pos.getZ(i) + this.dustVel[i * 3 + 2] * dt
      if (x > ARENA.bounds) x = -ARENA.bounds
      if (z > ARENA.bounds) z = -ARENA.bounds
      if (y < 2) y = 90
      if (y > 120) y = 6
      pos.setXYZ(i, x, y, z)
    }
    pos.needsUpdate = true
  }

  private makeSky(): THREE.Mesh {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: PALETTE.skyTop },
        horizon: { value: PALETTE.horizon },
        sunDir: { value: new THREE.Vector3(90, 150, 60).normalize() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
        varying vec3 vDir;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float sum = 0.0; float amp = 0.5;
          for (int i = 0; i < 5; i++) { sum += amp * vnoise(p); p *= 2.07; amp *= 0.5; }
          return sum;
        }

        void main() {
          float h = clamp(vDir.y, -1.0, 1.0);
          // Ufuk pusu -> orta mavi -> zenith: üç duraklı, gerçekçi bir gradyan.
          vec3 mid = mix(horizon, top, 0.45);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.05, h));
          col = mix(col, top, smoothstep(0.03, 0.34, h));
          col = mix(col, horizon * 0.97, 1.0 - smoothstep(-0.4, 0.0, h));

          // Yükseklik katmanında kümülatif bulut örtüsü.
          vec2 uv = vDir.xz / max(h + 0.08, 0.04) * 1.7;
          float cover = fbm(uv + vec2(11.3, 4.7));
          float cloud = smoothstep(0.56, 0.82, cover) * smoothstep(0.06, 0.42, h) * (1.0 - smoothstep(0.8, 0.99, h));
          float shade = smoothstep(0.45, 0.95, fbm(uv * 2.2));
          vec3 cloudCol = mix(vec3(0.82, 0.83, 0.86), vec3(1.0, 0.98, 0.94), shade);
          col = mix(col, cloudCol, cloud * 0.7);

          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += vec3(1.0, 0.9, 0.7) * (pow(s, 1200.0) * 3.2 + pow(s, 26.0) * 0.3 + pow(s, 6.0) * 0.1);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    })
    const sky = new THREE.Mesh(new THREE.SphereGeometry(620, 48, 24), material)
    sky.renderOrder = -1
    return sky
  }

  private addGround(): void {
    const geo = new THREE.PlaneGeometry(1200, 1200, 96, 96)
    geo.rotateX(-Math.PI / 2)
    // Şehir dışındaki beton zeminde düşük genlikli yüzey farkı.
    const pos = geo.attributes.position as THREE.BufferAttribute
    const random = rng(9182)
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = Math.sin(x * 0.012) * Math.cos(z * 0.009) * 0.18 + (random() - 0.5) * 0.06
      pos.setY(i, h)
    }
    geo.computeVertexNormals()
    // Çok hafif ton farkı: geniş beton zeminin tekdüzeliğini azaltır.
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const tone = 0.82 + 0.16 * (0.5 + 0.5 * Math.sin(x * 0.006 + Math.cos(z * 0.004) * 2.2)) + 0.06 * Math.sin(z * 0.02)
      colors[i * 3] = tone
      colors[i * 3 + 1] = tone * 0.985
      colors[i * 3 + 2] = tone * 0.95
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const groundMap = concreteTexture().clone()
    groundMap.wrapS = groundMap.wrapT = THREE.RepeatWrapping
    groundMap.repeat.set(42, 42)
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#737a7e', map: groundMap, vertexColors: true, roughness: 1, metalness: 0.02 }),
    )
    ground.position.y = ARENA.ground
    ground.receiveShadow = true
    this.scene.add(ground)
    this.physics.addStaticBox(new THREE.Vector3(0, ARENA.ground - 2, 0), new THREE.Vector3(1200, 4, 1200))

    // Şehir zemini: asfalt plaka.
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(320, 300),
      new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.94, metalness: 0.06 }),
    )
    asphalt.rotation.x = -Math.PI / 2
    asphalt.position.set(0, 0.06, -100)
    asphalt.receiveShadow = true
    this.scene.add(asphalt)

  }

  private addDistantSkyline(random: () => number): void {
    // Görüş sınırının ardında tek instanced mesh ile şehir silueti oluşturulur.
    const count = 56
    const skyline = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0.04 }),
      count,
    )
    const colors = ['#48575f', '#53636b', '#607078', '#6a777d'].map(color => new THREE.Color(color))
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    for (let i = 0; i < count; i += 1) {
      const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.12
      const radius = 285 + random() * 110
      const height = 24 + random() * 86
      position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius - 25)
      scale.set(14 + random() * 24, height, 14 + random() * 24)
      matrix.compose(position, rotation, scale)
      skyline.setMatrixAt(i, matrix)
      skyline.setColorAt(i, colors[Math.floor(random() * colors.length)])
    }
    skyline.instanceMatrix.needsUpdate = true
    if (skyline.instanceColor) skyline.instanceColor.needsUpdate = true
    skyline.castShadow = false
    skyline.receiveShadow = false
    this.scene.add(skyline)
  }

  private addCity(random: () => number): void {
    // Düzenli sokak aralarında farklı yükseklikte ofis ve apartman blokları.
    const blocks: { x: number; z: number; w: number; d: number; h: number }[] = [
      { x: -120, z: -80, w: 24, d: 24, h: 38 },
      { x: -55, z: -80, w: 26, d: 24, h: 66 },
      { x: 45, z: -80, w: 28, d: 26, h: 46 },
      { x: 125, z: -80, w: 24, d: 24, h: 58 },
      { x: -120, z: -112, w: 24, d: 24, h: 56 },
      { x: -55, z: -112, w: 30, d: 26, h: 112 },
      { x: 45, z: -112, w: 30, d: 26, h: 78 },
      { x: 125, z: -112, w: 26, d: 24, h: 68 },
      { x: -120, z: -180, w: 26, d: 26, h: 48 },
      { x: -55, z: -180, w: 28, d: 26, h: 72 },
      { x: 45, z: -180, w: 30, d: 26, h: 96 },
      { x: 125, z: -180, w: 26, d: 26, h: 58 },
      { x: -120, z: -214, w: 26, d: 26, h: 64 },
      { x: -55, z: -214, w: 30, d: 26, h: 84 },
      { x: 45, z: -214, w: 28, d: 26, h: 62 },
      { x: 125, z: -214, w: 28, d: 26, h: 108 },
    ]
    for (const b of blocks) this.addBuilding(b.x, b.z, b.w, b.d, b.h, random)

    // Bütün çatı saçakları tek instanced mesh: blok siluetlerini daha okunaklı yapar.
    const roofCaps = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      mat('#77858a', 0.72, 0.28),
      blocks.length,
    )
    const roofMatrix = new THREE.Matrix4()
    const roofPosition = new THREE.Vector3()
    const roofScale = new THREE.Vector3()
    const roofRotation = new THREE.Quaternion()
    blocks.forEach((b, i) => {
      roofPosition.set(b.x, b.h + 0.22, b.z)
      roofScale.set(b.w + 1.2, 0.48, b.d + 1.2)
      roofCaps.setMatrixAt(i, roofMatrix.compose(roofPosition, roofRotation, roofScale))
    })
    roofCaps.instanceMatrix.needsUpdate = true
    roofCaps.castShadow = false
    roofCaps.receiveShadow = false
    this.scene.add(roofCaps)
  }

  private addCityLandmark(): void {
    // Ana bulvarın kuzeyindeki yüksek kule, menü kamerasından da şehir odağı olarak seçilsin.
    const x = -55
    const z = -112
    const frontZ = z + 13.25
    const ribs = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.72, 108, 0.42),
      mat('#a3adaf', 0.62, 0.3),
      7,
    )
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    const rotation = new THREE.Quaternion()
    for (let i = 0; i < 7; i += 1) {
      position.set(x - 13 + i * 4.3, 55, frontZ)
      ribs.setMatrixAt(i, matrix.compose(position, rotation, scale))
    }
    ribs.instanceMatrix.needsUpdate = true
    ribs.castShadow = false
    ribs.receiveShadow = false

    const bands = new THREE.InstancedMesh(
      new THREE.BoxGeometry(30.8, 0.55, 0.48),
      mat('#4d5b60', 0.58, 0.42),
      2,
    )
    for (const [i, y] of [37, 75].entries()) {
      position.set(x, y, frontZ + 0.02)
      bands.setMatrixAt(i, matrix.compose(position, rotation, scale))
    }
    bands.instanceMatrix.needsUpdate = true
    bands.castShadow = false
    bands.receiveShadow = false

    const crown = new THREE.Mesh(new THREE.BoxGeometry(14, 1.8, 10), mat('#455257', 0.62, 0.42))
    crown.position.set(x, 112.8, z)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.52, 8, 6), glowMat(PALETTE.accent, 1.8))
    beacon.position.set(x, 114.1, z)
    const wayfinding = new THREE.Mesh(new THREE.BoxGeometry(0.42, 28, 0.12), glowMat(PALETTE.teal, 0.65))
    wayfinding.position.set(x + 8.2, 57, frontZ + 0.28)
    this.scene.add(ribs, bands, crown, beacon, wayfinding)
  }

  private addCityInfrastructure(): void {
    const roadMaterial = mat('#30373b', 0.92, 0.04)
    const avenueX = [-90, 0, 90]
    const avenueZ = [-50, -145, -235]
    for (const x of avenueX) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 270), roadMaterial)
      road.position.set(x, 0.12, -125)
      this.scene.add(road)
    }
    for (const z of avenueZ) {
      const road = new THREE.Mesh(new THREE.BoxGeometry(320, 0.1, 12), roadMaterial)
      road.position.set(0, 0.12, z)
      this.scene.add(road)
    }

    // Tek seferde çizilen kısa şeritler; küçük cihazlarda ayrı mesh sayısını artırmaz.
    const markingMaterial = new THREE.MeshBasicMaterial({ color: '#d8d0ad' })
    const matrix = new THREE.Matrix4()
    const rotation = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    const vertical = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.035, 4.5), markingMaterial, 36)
    let n = 0
    for (const x of avenueX) for (let z = -220; z < -35; z += 18) {
      position.set(x, 0.19, z)
      vertical.setMatrixAt(n++, matrix.compose(position, rotation, scale))
    }
    vertical.count = n
    vertical.instanceMatrix.needsUpdate = true
    this.scene.add(vertical)

    const horizontal = new THREE.InstancedMesh(new THREE.BoxGeometry(4.5, 0.035, 0.3), markingMaterial, 48)
    n = 0
    for (const z of avenueZ) for (let x = -148; x < 155; x += 20) {
      position.set(x, 0.19, z)
      horizontal.setMatrixAt(n++, matrix.compose(position, rotation, scale))
    }
    horizontal.count = n
    horizontal.instanceMatrix.needsUpdate = true
    this.scene.add(horizontal)

    // Her kavşakta zebra geçitleri; 180 çizgi tek instanced draw call ile çizilir.
    const crosswalk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 0.035, 7), markingMaterial, 180)
    const crosswise = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    n = 0
    for (const x of avenueX) for (const z of avenueZ) {
      for (const side of [-1, 1]) for (let stripe = -2; stripe <= 2; stripe += 1) {
        position.set(x + side * 8 + stripe * 1.2, 0.19, z)
        crosswalk.setMatrixAt(n++, matrix.compose(position, rotation, scale))
        position.set(x, 0.19, z + side * 8 + stripe * 1.2)
        crosswalk.setMatrixAt(n++, matrix.compose(position, crosswise, scale))
      }
    }
    crosswalk.count = n
    crosswalk.instanceMatrix.needsUpdate = true
    crosswalk.castShadow = false
    crosswalk.receiveShadow = false
    this.scene.add(crosswalk)
  }

  private addStreetFurniture(): void {
    // Sokak lambaları ve armatürleri instanced çizilir; gerçek ışık kaynağı ekleyerek FPS düşürmez.
    const avenues = [-90, 0, 90]
    const zPositions = [-62, -94, -125, -167, -198, -224]
    const count = avenues.length * zPositions.length * 2
    const steel = mat('#4b5559', 0.62, 0.48)
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.22, 7, 6), steel, count)
    const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 0.16, 0.2), steel, count)
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.22, 0.52), mat('#303a3e', 0.58, 0.48), count)
    const emitters = new THREE.InstancedMesh(new THREE.BoxGeometry(0.68, 0.055, 0.34), glowMat('#f0d9ad', 0.8), count)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    const rotation = new THREE.Quaternion()
    let i = 0
    for (const avenue of avenues) {
      for (const z of zPositions) {
        for (const side of [-1, 1]) {
          const x = avenue + side * 8.2
          position.set(x, 3.5, z)
          poles.setMatrixAt(i, matrix.compose(position, rotation, scale))
          position.set(x - side * 0.85, 6.65, z)
          arms.setMatrixAt(i, matrix.compose(position, rotation, scale))
          position.set(x - side * 1.65, 6.45, z)
          heads.setMatrixAt(i, matrix.compose(position, rotation, scale))
          position.y = 6.32
          emitters.setMatrixAt(i, matrix.compose(position, rotation, scale))
          i += 1
        }
      }
    }
    for (const mesh of [poles, arms, heads, emitters]) {
      mesh.instanceMatrix.needsUpdate = true
      mesh.castShadow = false
      mesh.receiveShadow = false
    }
    this.scene.add(poles, arms, heads, emitters)
  }

  private addCityPark(): void {
    const turf = new THREE.Mesh(new THREE.BoxGeometry(38, 0.2, 42), mat('#4f6958', 1, 0))
    turf.position.set(48, 0.12, -22)
    turf.receiveShadow = true
    this.scene.add(turf)
    const pathMaterial = mat('#adb1aa', 0.95, 0.02)
    const pathA = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.04, 40), pathMaterial)
    pathA.position.set(48, 0.25, -22)
    const pathB = new THREE.Mesh(new THREE.BoxGeometry(36, 0.04, 2.5), pathMaterial)
    pathB.position.set(48, 0.26, -22)
    this.scene.add(pathA, pathB)

    const placements: [number, number][] = [
      [-13, -13], [0, -14], [13, -13], [-13, 13], [0, 14], [13, 13], [-14, 0], [14, 0],
    ]
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6), mat('#58483b', 1, 0), placements.length)
    const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(2.5, 6, 7), mat('#3c624f', 1, 0), placements.length)
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3(1, 1, 1)
    const rotation = new THREE.Quaternion()
    placements.forEach(([x, z], i) => {
      position.set(48 + x, 2.35, -22 + z)
      trunks.setMatrixAt(i, matrix.compose(position, rotation, scale))
      position.y = 6.8
      crowns.setMatrixAt(i, matrix.compose(position, rotation, scale))
    })
    trunks.instanceMatrix.needsUpdate = true
    crowns.instanceMatrix.needsUpdate = true
    this.scene.add(trunks, crowns)
  }

  private addCityWaterfront(): void {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 240),
      new THREE.MeshStandardMaterial({ color: '#39727c', roughness: 0.34, metalness: 0.16 }),
    )
    water.rotation.x = -Math.PI / 2
    water.position.set(-150, 0.16, -130)
    this.scene.add(water)

    const bankMaterial = mat('#777f80', 0.95, 0.04)
    for (const x of [-160.8, -139.2]) {
      const bank = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 242), bankMaterial)
      bank.position.set(x, 0.42, -130)
      bank.receiveShadow = true
      this.scene.add(bank)
    }

    // Tek köprü bağlantısı üzerinden geçen ana cadde; gövde ve korkuluklar çarpışabilir.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(27, 1, 14), mat('#666e72', 0.88, 0.08))
    deck.position.set(-150, 1.15, -145)
    deck.receiveShadow = true
    deck.castShadow = true
    this.scene.add(deck)
    this.physics.addStaticBox(deck.position, new THREE.Vector3(27, 1, 14))
    for (const z of [-152, -138]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(27, 1.2, 0.32), mat('#495258', 0.72, 0.3))
      rail.position.set(-150, 2.25, z)
      this.scene.add(rail)
      this.physics.addStaticBox(rail.position, new THREE.Vector3(27, 1.2, 0.32))
    }
  }

  private addBuilding(x: number, z: number, w: number, d: number, h: number, random: () => number): void {
    const tone = random()
    const base = tone > 0.66 ? PALETTE.concrete : tone > 0.33 ? PALETTE.concreteDark : '#6f6a5f'
    // Cephe dokusu binanın ölçeğine göre tekrarlanır: kat sayısı arttıkça pencere satırları artar.
    const facade = facadeTexture()
    const map = facade.map.clone()
    const emissiveMap = facade.emissive.clone()
    const repeatX = Math.max(0.6, w / 34)
    const repeatY = Math.max(1, h / 34)
    for (const tex of [map, emissiveMap]) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(repeatX, repeatY)
      tex.needsUpdate = true
    }
    const shellMat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap,
      emissive: new THREE.Color('#ffd6a5'),
      emissiveIntensity: 0.22,
      color: new THREE.Color(base).lerp(new THREE.Color('#ffffff'), 0.3),
      roughness: 0.72,
      metalness: 0.16,
    })
    const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shellMat)
    shell.position.set(x, h / 2, z)
    shell.castShadow = true
    shell.receiveShadow = true
    this.scene.add(shell)
    this.physics.addStaticBox(new THREE.Vector3(x, h / 2, z), new THREE.Vector3(w, h, d))

    // Çatı detayı: klima üniteleri ve anten.
    const units = 1 + Math.floor(random() * 3)
    for (let i = 0; i < units; i += 1) {
      const uw = 2 + random() * 4
      const unit = new THREE.Mesh(new THREE.BoxGeometry(uw, 1.6, uw * 0.8), mat(PALETTE.metal, 0.7, 0.4))
      unit.position.set(x + (random() - 0.5) * (w - uw - 2), h + 0.8, z + (random() - 0.5) * (d - uw - 2))
      unit.castShadow = true
      this.scene.add(unit)
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8 + random() * 8, 6), mat(PALETTE.metal, 0.5, 0.7))
    mast.position.set(x + w * 0.3, h + 6, z - d * 0.3)
    this.scene.add(mast)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), glowMat('#ff3b30', 2.2))
    beacon.position.set(mast.position.x, mast.position.y + mast.geometry.parameters.height / 2, mast.position.z)
    this.scene.add(beacon)
  }

  private addProps(random: () => number): void {
    // Doğma noktasında işaret direkleri ve bir iniş platformu.
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 0.6, 24), mat('#4a4a46', 0.85, 0.15))
    pad.position.set(ARENA.spawn.x, 0.3, ARENA.spawn.z)
    pad.receiveShadow = true
    this.scene.add(pad)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7.4, 0.18, 6, 40), glowMat(PALETTE.teal, 1.1))
    ring.rotation.x = Math.PI / 2
    ring.position.set(ARENA.spawn.x, 0.65, ARENA.spawn.z)
    this.scene.add(ring)

    for (let i = 0; i < 10; i += 1) {
      const a = random() * Math.PI * 2
      const r = 14 + random() * 40
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 5), mat('#3d3f42', 0.7, 0.4))
      post.position.set(ARENA.spawn.x + Math.cos(a) * r, 2.5, ARENA.spawn.z + Math.sin(a) * r)
      this.scene.add(post)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), glowMat(PALETTE.accent, 1.8))
      lamp.position.set(post.position.x, 5.1, post.position.z)
      this.scene.add(lamp)
    }

    // Uçuş rotasını kıran asılı konteynerler (çatı arası engeller).
    for (const p of [
      { x: -20, y: 40, z: -30 },
      { x: 40, y: 56, z: -120 },
      { x: -60, y: 30, z: -110 },
    ]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), mat('#5c5a55', 0.85, 0.2))
      crate.position.set(p.x, p.y, p.z)
      crate.castShadow = true
      this.scene.add(crate)
      this.physics.addStaticBox(crate.position, new THREE.Vector3(8, 4, 6))
    }
    this.props.length = 0
  }

  private addBoundary(): void {
    const b = ARENA.bounds + 6
    const walls = [
      { pos: new THREE.Vector3(0, 120, -b), size: new THREE.Vector3(b * 2, 240, 6) },
      { pos: new THREE.Vector3(0, 120, b), size: new THREE.Vector3(b * 2, 240, 6) },
      { pos: new THREE.Vector3(-b, 120, 0), size: new THREE.Vector3(6, 240, b * 2) },
      { pos: new THREE.Vector3(b, 120, 0), size: new THREE.Vector3(6, 240, b * 2) },
      { pos: new THREE.Vector3(0, 210, 0), size: new THREE.Vector3(b * 2, 6, b * 2) },
    ]
    for (const w of walls) this.physics.addStaticBox(w.pos, w.size)
  }

  private makeDust(random: () => number): { points: THREE.Points; vel: Float32Array } {
    const count = 420
    const positions = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (random() - 0.5) * ARENA.bounds * 2
      positions[i * 3 + 1] = 4 + random() * 110
      positions[i * 3 + 2] = (random() - 0.5) * ARENA.bounds * 2
      vel[i * 3] = 1.5 + random() * 3
      vel[i * 3 + 1] = (random() - 0.5) * 0.6
      vel[i * 3 + 2] = (random() - 0.5) * 1.2
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const material = new THREE.PointsMaterial({
      color: '#f0dcb8',
      size: 0.55,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    const points = new THREE.Points(geo, material)
    points.frustumCulled = false
    return { points, vel }
  }
}
