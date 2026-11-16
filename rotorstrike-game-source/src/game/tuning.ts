import { CONFIG, DEFAULT_CONFIG } from './config'

/**
 * Geliştirme sırasında (yalnızca `pnpm dev`) Tweak paneli için oynanış parametreleri.
 * Her bağlama CONFIG'teki canlı değeri okur/yazar; varsayılanlar değişmez kaynaktan gelir.
 * Yayın derlemesinde bu modül yüklenmez.
 */
type Mode = 'LIVE' | 'NEXT_RUN'
type Section = keyof typeof CONFIG

type Control = {
  id: string
  type: 'number'
  category: string
  label: string
  description: string
  unit: string
  default: number
  min: number
  max: number
  step: number
  applyMode: Mode
  integrity: 'COSMETIC' | 'GAMEPLAY'
}

type Binding = { control: Control; read(): number; write(value: number): void }

const bindings: Binding[] = []

function number(
  section: Section,
  key: string,
  category: string,
  label: string,
  min: number,
  max: number,
  step: number,
  unit: string,
  applyMode: Mode = 'LIVE',
): void {
  const values = CONFIG[section] as unknown as Record<string, number>
  const defaults = DEFAULT_CONFIG[section] as unknown as Record<string, number>
  bindings.push({
    control: Object.freeze({
      id: `${section}.${key}`,
      type: 'number',
      category,
      label,
      description: applyMode === 'NEXT_RUN' ? 'Bir sonraki koşuda geçerli olur.' : 'Önizlemeyi anında günceller.',
      unit,
      default: defaults[key]!,
      min,
      max,
      step,
      applyMode,
      integrity: section === 'camera' ? 'COSMETIC' : 'GAMEPLAY',
    }),
    read: () => values[key]!,
    write: value => {
      values[key] = value
    },
  })
}

number('flight', 'accel', 'Uçuş', 'İtki ivmesi', 20, 120, 2, 'm/s²')
number('flight', 'vertical', 'Uçuş', 'Dikey itki', 10, 90, 2, 'm/s²')
number('flight', 'drag', 'Uçuş', 'Stabilize sürüklenme', 0.5, 6, 0.1, '/sn')
number('flight', 'driftDrag', 'Uçuş', 'Serbest sürüklenme', 0.02, 1.5, 0.02, '/sn')
number('flight', 'maxSpeed', 'Uçuş', 'Taban azami hız', 15, 80, 1, 'm/s')
number('flight', 'ceiling', 'Uçuş', 'Uçuş tavanı', 60, 300, 5, 'm')
number('weapon', 'fireRate', 'Silah', 'Ateş hızı', 2, 5.8, 0.2, '/sn')
number('weapon', 'range', 'Silah', 'Etkili menzil', 60, 600, 10, 'm')
number('weapon', 'spread', 'Silah', 'Yayılım', 0, 0.06, 0.001, 'rad')
number('camera', 'fov', 'Kamera', 'Görüş açısı', 55, 110, 1, '°')
number('camera', 'recoil', 'Kamera', 'Geri tepme', 0, 0.03, 0.001, 'rad')
number('waves', 'firstCount', 'Dalgalar', 'İlk dalga düşmanı', 1, 8, 1, '', 'NEXT_RUN')
number('waves', 'growth', 'Dalgalar', 'Dalga büyümesi', 0, 3, 1, '', 'NEXT_RUN')
number('waves', 'maxAlive', 'Dalgalar', 'Aynı anda azami düşman', 1, 12, 1, '')
number('waves', 'intermission', 'Dalgalar', 'Hazırlık süresi', 0, 20, 1, 'sn')
number('economy', 'perHit', 'Ekonomi', 'İsabet kredisi', 0, 100, 5, 'KR')
number('economy', 'perKill', 'Ekonomi', 'Düşürme kredisi', 0, 600, 10, 'KR')
number('economy', 'perWave', 'Ekonomi', 'Dalga primi', 0, 1000, 20, 'KR')
number('economy', 'perSecond', 'Ekonomi', 'Saniye kredisi', 0, 20, 1, 'KR')
number('ai', 'accuracy', 'Yapay zekâ', 'Düşman isabetliliği', 0, 0.9, 0.01, '')
number('ai', 'accuracyMax', 'Yapay zekâ', 'Azami isabetlilik', 0.1, 0.95, 0.01, '')

const byId = new Map(bindings.map(binding => [binding.control.id, binding]))
let requested: Record<string, number> = Object.fromEntries(bindings.map(({ control }) => [control.id, control.default]))
let unranked = false

const gameplayModified = () =>
  bindings.some(binding => binding.control.integrity === 'GAMEPLAY' && binding.read() !== binding.control.default)

export const tuning = {
  get unranked(): boolean {
    return unranked
  },
  controls: Object.freeze(bindings.map(binding => binding.control)),
  read() {
    return {
      requested: { ...requested },
      active: Object.fromEntries(bindings.map(binding => [binding.control.id, binding.read()])),
    }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    const entries = Object.entries(patch)
    if (entries.length > bindings.length) throw new Error('Invalid patch')
    for (const [id, value] of entries) {
      const control = byId.get(id)?.control
      if (!control || typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) {
        throw new Error('Invalid value')
      }
      const steps = (value - control.min) / control.step
      if (value !== control.default && Math.abs(steps - Math.round(steps)) > 1e-7) throw new Error('Invalid increment')
    }
    // Tüm yazmalar basit atamalardır ve bir sonraki fizik/render geri çağrısından önce tamamlanır.
    requested = { ...requested, ...(patch as Record<string, number>) }
    for (const [id, value] of entries) {
      const binding = byId.get(id)!
      if (binding.control.applyMode === 'LIVE') binding.write(value)
    }
    unranked ||= gameplayModified()
  },
  activate(boundary: 'run'): void {
    for (const binding of bindings) {
      if (binding.control.applyMode === 'NEXT_RUN') binding.write(requested[binding.control.id]!)
    }
    unranked = boundary === 'run' ? gameplayModified() : unranked || gameplayModified()
  },
}
