import * as THREE from 'three'

/**
 * Prosedürel doku üretimi: harici görsel dosyası yok. Her doku bir kez çizilip önbelleğe alınır,
 * böylece arena kurulurken aynı canvas yeniden üretilmez.
 */
const cache = new Map<string, THREE.Texture>()

function surface(size: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas bağlamı alınamadı')
  return ctx
}

function finish(ctx: CanvasRenderingContext2D, repeat: number, srgb = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat, repeat)
  texture.anisotropy = 4
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function noise(ctx: CanvasRenderingContext2D, size: number, count: number, colors: string[], maxR = 2.4, alpha = 0.5): void {
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = alpha * (0.3 + Math.random() * 0.7)
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)]
    const r = 0.4 + Math.random() * maxR
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/** Çöl zemini: ince kum taneleri, rüzgâr dalgaları ve hafif çatlaklar. */
export function sandTexture(): THREE.Texture {
  const key = 'sand'
  const cached = cache.get(key)
  if (cached) return cached
  const size = 512
  const ctx = surface(size)
  ctx.fillStyle = '#c3a172'
  ctx.fillRect(0, 0, size, size)
  // Rüzgâr dalgaları: birbirini izleyen açık/koyu bantlar.
  for (let y = 0; y < size; y += 1) {
    const wave = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.31 + 1.4) * 0.3 + Math.sin(y * 0.013) * 0.5
    const shade = 0.5 + wave * 0.5
    ctx.fillStyle = `rgba(${Math.round(150 + shade * 46)},${Math.round(122 + shade * 38)},${Math.round(84 + shade * 30)},0.55)`
    ctx.fillRect(0, y, size, 1)
  }
  // Dalga kırışıklıkları.
  ctx.lineWidth = 1.2
  for (let i = 0; i < 90; i += 1) {
    const y = Math.random() * size
    const amp = 2 + Math.random() * 5
    ctx.strokeStyle = `rgba(255,236,200,${0.05 + Math.random() * 0.07})`
    ctx.beginPath()
    for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * amp)
    ctx.stroke()
  }
  noise(ctx, size, 5200, ['#8f7248', '#dcc094', '#a98a5d', '#6f5836'], 1.9, 0.35)
  const texture = finish(ctx, 96)
  cache.set(key, texture)
  return texture
}

/** Kanyon kayası: katmanlı tortul bantlar, çatlaklar ve aşınma. */
export function rockTexture(): THREE.Texture {
  const key = 'rock'
  const cached = cache.get(key)
  if (cached) return cached
  const size = 512
  const ctx = surface(size)
  ctx.fillStyle = '#9b7a58'
  ctx.fillRect(0, 0, size, size)
  const bands = ['#b08a61', '#8d6b4b', '#a87f58', '#7a5c40', '#c19a6b', '#6f5439']
  let y = 0
  while (y < size) {
    const h = 8 + Math.random() * 34
    ctx.globalAlpha = 0.55 + Math.random() * 0.35
    ctx.fillStyle = bands[Math.floor(Math.random() * bands.length)]
    ctx.beginPath()
    ctx.moveTo(0, y)
    for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.02 + y) * 3)
    ctx.lineTo(size, y + h)
    for (let x = size; x >= 0; x -= 16) ctx.lineTo(x, y + h + Math.sin(x * 0.03 + y) * 3)
    ctx.closePath()
    ctx.fill()
    y += h
  }
  ctx.globalAlpha = 1
  // Dikey çatlaklar.
  for (let i = 0; i < 46; i += 1) {
    const x = Math.random() * size
    ctx.strokeStyle = `rgba(52,38,26,${0.18 + Math.random() * 0.25})`
    ctx.lineWidth = 0.6 + Math.random() * 1.8
    ctx.beginPath()
    let cy = 0
    ctx.moveTo(x, 0)
    while (cy < size) {
      cy += 12 + Math.random() * 30
      ctx.lineTo(x + (Math.random() - 0.5) * 12, cy)
    }
    ctx.stroke()
  }
  noise(ctx, size, 4200, ['#6b5138', '#c6a276', '#8a6a48', '#5a432f'], 2, 0.3)
  const texture = finish(ctx, 4)
  cache.set(key, texture)
  return texture
}

/** Beton cephe: panel derzleri, leke ve pas izleri. */
export function concreteTexture(): THREE.Texture {
  const key = 'concrete'
  const cached = cache.get(key)
  if (cached) return cached
  const size = 256
  const ctx = surface(size)
  ctx.fillStyle = '#8f8b81'
  ctx.fillRect(0, 0, size, size)
  noise(ctx, size, 2600, ['#7d796f', '#a19c91', '#6c685f'], 2.6, 0.35)
  ctx.strokeStyle = 'rgba(58,56,52,0.4)'
  ctx.lineWidth = 1.4
  for (let i = 0; i <= size; i += 64) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
    ctx.stroke()
  }
  // Nem ve pas sızıntısı.
  for (let i = 0; i < 18; i += 1) {
    const x = Math.random() * size
    const w = 2 + Math.random() * 7
    const grad = ctx.createLinearGradient(x, 0, x, size)
    grad.addColorStop(0, `rgba(84,62,44,${0.18 + Math.random() * 0.16})`)
    grad.addColorStop(1, 'rgba(84,62,44,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, Math.random() * size * 0.4, w, size)
  }
  const texture = finish(ctx, 1)
  cache.set(key, texture)
  return texture
}

/** Asfalt: koyu gri, ince agrega ve lastik izleri. */
export function asphaltTexture(): THREE.Texture {
  const key = 'asphalt'
  const cached = cache.get(key)
  if (cached) return cached
  const size = 256
  const ctx = surface(size)
  ctx.fillStyle = '#4a4945'
  ctx.fillRect(0, 0, size, size)
  noise(ctx, size, 4200, ['#3c3b38', '#5b5a55', '#33322f', '#6a6862'], 1.6, 0.4)
  for (let i = 0; i < 6; i += 1) {
    ctx.strokeStyle = `rgba(24,24,22,${0.1 + Math.random() * 0.1})`
    ctx.lineWidth = 6 + Math.random() * 10
    ctx.beginPath()
    ctx.moveTo(0, Math.random() * size)
    ctx.lineTo(size, Math.random() * size)
    ctx.stroke()
  }
  const texture = finish(ctx, 26)
  cache.set(key, texture)
  return texture
}

/** Cephe dokusu: koyu cam ızgarası + sıcak/soğuk yanan pencereler (ayrıca emissive). */
export function facadeTexture(): { map: THREE.Texture; emissive: THREE.Texture } {
  const key = 'facade'
  const cached = cache.get(key)
  if (cached) return { map: cached, emissive: cache.get('facade-emissive')! }
  const size = 512
  const base = surface(size)
  const glow = surface(size)
  base.fillStyle = '#9c988e'
  base.fillRect(0, 0, size, size)
  glow.fillStyle = '#000000'
  glow.fillRect(0, 0, size, size)
  const cols = 14
  const rows = 18
  const cw = size / cols
  const ch = size / rows
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const x = c * cw + cw * 0.18
      const y = r * ch + ch * 0.2
      const w = cw * 0.64
      const h = ch * 0.5
      const lit = Math.random()
      base.fillStyle = lit > 0.62 ? '#39414a' : '#4d555e'
      base.fillRect(x, y, w, h)
      base.fillStyle = 'rgba(255,255,255,0.06)'
      base.fillRect(x, y, w, h * 0.18)
      if (lit > 0.62) {
        const warm = Math.random() > 0.3
        glow.fillStyle = warm ? `rgba(255,206,150,${0.35 + Math.random() * 0.45})` : `rgba(150,214,255,${0.3 + Math.random() * 0.4})`
        glow.fillRect(x, y, w, h)
      }
    }
  }
  // Kat arası bantlar ve düşey mullionlar: cepheyi ölçekli gösterir.
  base.fillStyle = 'rgba(46, 44, 40, 0.5)'
  for (let r = 0; r < rows; r += 1) base.fillRect(0, r * ch + ch * 0.06, size, Math.max(1, ch * 0.08))
  for (let c = 0; c <= cols; c += 1) base.fillRect(c * cw - 1, 0, 2, size)
  noise(base, size, 2600, ['#5b5850', '#7d7a71', '#8f8b82'], 2.4, 0.3)
  const map = finish(base, 1)
  const emissive = finish(glow, 1)
  cache.set(key, map)
  cache.set('facade-emissive', emissive)
  return { map, emissive }
}
