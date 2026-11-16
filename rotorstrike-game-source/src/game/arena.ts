import * as THREE from 'three'
import type { Physics } from '../engine/physics'

import { asphaltTexture, facadeTexture, rockTexture, sandTexture } from './textures'
/**
 * Savaş alanı: çöl kanyonu ile endüstriyel şehir çatılarının birleşimi. Bütün geometri ilkel
 * şekillerden ve deterministik bir rastgele üreticiden gelir; collider'lar görünen mesh
 * boyutlarıyla aynı yerden türetilir.
 */
export const ARENA = {
  /** Oyuncunun doğduğu nokta — şehre bakan bir tepe. */
  spawn: new THREE.Vector3(0, 42, 96),
  ground: 0,
  /** Uçuş alanı sınırı (m). */
  bounds: 250,
}

export const PALETTE = {
  skyTop: new THREE.Color('#3478ad'),
  horizon: new THREE.Color('#e2c092'),
  sand: new THREE.Color('#c9a877'),
  sandDark: new THREE.Color('#a8875c'),
  rock: new THREE.Color('#9c7b5c'),
  rockDark: new THREE.Color('#6f5641'),
  concrete: new THREE.Color('#8d8a80'),
  concreteDark: new THREE.Color('#5c5a55'),
  metal: new THREE.Color('#7d858c'),
  rust: new THREE.Color('#a5653c'),
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
    this.addCanyon(random)
    this.addCity(random)
    this.addProps(random)
    this.addBoundary()

    const dust = this.makeDust(random)
    this.dust = dust.points
    this.dustVel = dust.vel
    this.scene.add(this.dust)

    // Düşman doğma noktaları: şehir ve kanyon çevresinde halka.
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2 + 0.4
      const r = 110 + random() * 90
      this.spawnPoints.push(new THREE.Vector3(Math.cos(a) * r, 28 + random() * 62, Math.sin(a) * r - 20))
    }
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
    // Hafif kum kabartması: düz bir levha yerine engebeli bir çöl tabanı.
    const pos = geo.attributes.position as THREE.BufferAttribute
    const random = rng(9182)
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i)
      const z = pos.getZ(i)
      const h = Math.sin(x * 0.012) * Math.cos(z * 0.009) * 1.6 + (random() - 0.5) * 0.9
      pos.setY(i, h)
    }
    geo.computeVertexNormals()
    // Büyük ölçekli ton farkı: kumun her yeri aynı renkte görünmesini engeller.
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
    const ground = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ map: sandTexture(), vertexColors: true, roughness: 1, metalness: 0 }),
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

    // Çölde dağınık kaya grupları ve çalı kümeleri: ölçek hissi veren küçük detaylar.
    const scatter = rng(77)
    for (let i = 0; i < 90; i += 1) {
      const a = scatter() * Math.PI * 2
      const r = 60 + scatter() * 420
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.abs(x) < 180 && z < -10 && z > -260) continue
      const size = 0.8 + scatter() * 3.4
      const geoRock = new THREE.IcosahedronGeometry(size, 0)
      jitter(geoRock, scatter, size * 0.4)
      const rock = new THREE.Mesh(geoRock, mat(scatter() > 0.5 ? PALETTE.rock : PALETTE.rockDark, 1, 0))
      rock.position.set(x, size * 0.4, z)
      rock.rotation.set(scatter() * 0.5, scatter() * Math.PI, scatter() * 0.4)
      rock.castShadow = true
      rock.receiveShadow = true
      this.scene.add(rock)
    }
  }

  private addCanyon(random: () => number): void {
    // Çevre mesaları: uçuş alanını çerçeveleyen kanyon duvarları.
    const ring = [
      { a: 0.15, r: 300, radius: 46, h: 96 },
      { a: 0.85, r: 330, radius: 58, h: 120 },
      { a: 1.6, r: 310, radius: 40, h: 84 },
      { a: 2.35, r: 340, radius: 62, h: 132 },
      { a: 3.05, r: 305, radius: 44, h: 90 },
      { a: 3.75, r: 335, radius: 54, h: 110 },
      { a: 4.5, r: 315, radius: 48, h: 100 },
      { a: 5.25, r: 345, radius: 66, h: 140 },
    ]
    for (const m of ring) {
      this.addMesa(Math.cos(m.a) * m.r, Math.sin(m.a) * m.r - 40, m.radius, m.h, random)
    }
    // İçeride kalan iki kaya kulesi: rota kırıcı.
    this.addMesa(-150, 30, 22, 58, random)
    this.addMesa(165, 10, 18, 46, random)

    // Dağınık kayalar.
    for (let i = 0; i < 40; i += 1) {
      const a = random() * Math.PI * 2
      const r = 70 + random() * 170
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r + 30
      const size = 2 + random() * 7
      const geo = new THREE.IcosahedronGeometry(size, 0)
      jitter(geo, random, size * 0.35)
      const rock = new THREE.Mesh(geo, mat(random() > 0.5 ? PALETTE.rock : PALETTE.rockDark, 1, 0))
      rock.position.set(x, size * 0.55, z)
      rock.rotation.set(random() * 0.4, random() * Math.PI, random() * 0.3)
      rock.castShadow = true
      rock.receiveShadow = true
      this.scene.add(rock)
      if (size > 4) this.physics.addStaticCylinder(new THREE.Vector3(x, size * 0.5, z), size * 0.85, size)
    }
  }

  private addMesa(x: number, z: number, radius: number, height: number, random: () => number): void {
    const geo = new THREE.CylinderGeometry(radius * 0.82, radius, height, 32, 8)
    jitter(geo, random, radius * 0.05)
    const mesa = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 1, metalness: 0 }))
    mesa.position.set(x, height / 2, z)
    mesa.castShadow = true
    mesa.receiveShadow = true
    this.scene.add(mesa)

    // Etek molozu: kayanın dibinde biriken kum konisi.
    const talus = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.98, radius * 1.34, height * 0.13, 24),
      new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, metalness: 0 }),
    )
    talus.position.set(x, height * 0.065, z)
    talus.receiveShadow = true
    talus.castShadow = true
    this.scene.add(talus)

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.84, radius * 0.82, 1.4, 26), mat(PALETTE.sand, 1, 0))
    cap.position.set(x, height + 0.4, z)
    cap.receiveShadow = true
    this.scene.add(cap)
    this.physics.addStaticCylinder(new THREE.Vector3(x, height / 2, z), radius * 0.9, height)
  }

  private addCity(random: () => number): void {
    const blocks: { x: number; z: number; w: number; d: number; h: number }[] = [
      { x: -52, z: -72, w: 30, d: 26, h: 62 },
      { x: -12, z: -96, w: 34, d: 30, h: 88 },
      { x: 34, z: -78, w: 26, d: 30, h: 54 },
      { x: 70, z: -116, w: 30, d: 34, h: 74 },
      { x: -70, z: -136, w: 26, d: 28, h: 44 },
      { x: -34, z: -168, w: 40, d: 30, h: 66 },
      { x: 22, z: -164, w: 28, d: 26, h: 50 },
      { x: 58, z: -196, w: 34, d: 30, h: 96 },
      { x: -96, z: -180, w: 24, d: 24, h: 38 },
      { x: 104, z: -60, w: 24, d: 28, h: 46 },
      { x: -110, z: -90, w: 22, d: 26, h: 58 },
      { x: 6, z: -40, w: 22, d: 22, h: 32 },
    ]
    for (const b of blocks) this.addBuilding(b.x, b.z, b.w, b.d, b.h, random)

    // Vinçler.
    this.addCrane(-86, -40, 52, 34, random)
    this.addCrane(86, -150, 60, 40, random)

    // İletişim kuleleri.
    this.addTower(-30, 30, 64)
    this.addTower(120, -20, 78)

    // Boru hatları ve konteyner yığını (alçak irtifa engelleri).
    this.addPipeRun(-120, -30, 60, random)
    this.addContainers(96, -100, random)
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
      emissiveIntensity: 0.4,
      color: new THREE.Color(base).lerp(new THREE.Color('#ffffff'), 0.55),
      roughness: 0.9,
      metalness: 0.1,
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

  private addCrane(x: number, z: number, mastHeight: number, jib: number, random: () => number): void {
    const group = new THREE.Group()
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, mastHeight, 1.6), mat('#e0a52b', 0.6, 0.4))
    mast.position.y = mastHeight / 2
    mast.castShadow = true
    group.add(mast)

    const top = new THREE.Mesh(new THREE.BoxGeometry(jib, 1.2, 1.4), mat('#e0a52b', 0.6, 0.4))
    top.position.set(jib * 0.22, mastHeight, 0)
    top.castShadow = true
    group.add(top)

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.2), mat('#2b2f33', 0.7, 0.3))
    cab.position.set(-1.2, mastHeight - 2.4, 0)
    group.add(cab)

    // Çelik halat ve kanca.
    const cableLen = 14 + random() * 16
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, cableLen, 4), mat('#1a1c1f', 0.6, 0.6))
    cable.position.set(jib * 0.55, mastHeight - cableLen / 2, 0)
    group.add(cable)
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.9), mat('#d8d2c4', 0.7, 0.5))
    hook.position.set(jib * 0.55, mastHeight - cableLen - 0.6, 0)
    group.add(hook)

    group.position.set(x, 0, z)
    group.rotation.y = random() * Math.PI
    this.scene.add(group)
    this.physics.addStaticBox(new THREE.Vector3(x, mastHeight / 2, z), new THREE.Vector3(2.4, mastHeight, 2.4))
  }

  private addTower(x: number, z: number, height: number): void {
    const group = new THREE.Group()
    const legs = 3
    for (let i = 0; i < legs; i += 1) {
      const a = (i / legs) * Math.PI * 2
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, height, 5), mat('#b8482e', 0.7, 0.4))
      leg.position.set(Math.cos(a) * 1.6, height / 2, Math.sin(a) * 1.6)
      group.add(leg)
    }
    for (let h = 6; h < height; h += 8) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.09, 4, 12), mat('#b8482e', 0.7, 0.4))
      ring.rotation.x = Math.PI / 2
      ring.position.y = h
      group.add(ring)
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), glowMat('#ff3b30', 2.4))
    beacon.position.y = height
    group.add(beacon)
    group.position.set(x, 0, z)
    this.scene.add(group)
    this.physics.addStaticCylinder(new THREE.Vector3(x, height / 2, z), 2.2, height)
  }

  private addPipeRun(x: number, z: number, length: number, random: () => number): void {
    const group = new THREE.Group()
    for (let i = 0; i < 3; i += 1) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, length, 10), mat(PALETTE.rust, 0.85, 0.2))
      pipe.rotation.z = Math.PI / 2
      pipe.position.set(0, 2.4 + i * 1.6, i * 1.8)
      pipe.castShadow = true
      group.add(pipe)
    }
    for (let i = 0; i < 5; i += 1) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.6, 5, 4.4), mat('#5a5d60', 0.8, 0.3))
      support.position.set(-length / 2 + (i / 4) * length, 2.5, 1.8)
      group.add(support)
    }
    group.position.set(x, 0, z)
    group.rotation.y = random() * 0.6
    this.scene.add(group)
    this.physics.addStaticBox(new THREE.Vector3(x, 3, z), new THREE.Vector3(length, 6, 5))
  }

  private addContainers(x: number, z: number, random: () => number): void {
    const colors = ['#b8482e', '#2f6f8f', '#c9a227', '#3f6b4a']
    for (let i = 0; i < 9; i += 1) {
      const w = 6
      const box3 = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 2.6), mat(colors[i % colors.length], 0.8, 0.3))
      box3.position.set(x + (random() - 0.5) * 16, 1.3 + (i > 5 ? 2.6 : 0), z + (random() - 0.5) * 14)
      box3.rotation.y = random() > 0.5 ? 0 : Math.PI / 2
      box3.castShadow = true
      this.scene.add(box3)
    }
  }

  private addProps(random: () => number): void {
    // Doğma tepesinde işaret direkleri ve bir iniş platformu.
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
      { x: -20, y: 40, z: -30, r: 0.4 },
      { x: 40, y: 56, z: -120, r: 1.2 },
      { x: -60, y: 30, z: -110, r: 0.8 },
    ]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 6), mat('#5c5a55', 0.85, 0.2))
      crate.position.set(p.x, p.y, p.z)
      crate.rotation.y = p.r
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

/** İlkel geometriyi elle yontulmuş kaya gibi göster, paylaşılan dikişleri kapalı tut. */
function jitter(geo: THREE.BufferGeometry, random: () => number, amount: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const offsets = new Map<string, THREE.Vector3>()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i)
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`
    let o = offsets.get(key)
    if (!o) {
      o = new THREE.Vector3((random() - 0.5) * amount, (random() - 0.5) * amount * 0.6, (random() - 0.5) * amount)
      offsets.set(key, o)
    }
    pos.setXYZ(i, v.x + o.x, v.y + o.y, v.z + o.z)
  }
  geo.computeVertexNormals()
}
