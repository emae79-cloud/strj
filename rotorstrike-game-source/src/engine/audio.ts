/**
 * Web Audio miksleyici: müzik, efekt ve sürekli motor/rüzgâr katmanları.
 * Tarayıcılar sesi ilk kullanıcı hareketinden sonra açar; `unlock()` başlık ekranında çağrılır.
 *
 * Ses dosyası yoktur: bütün efektler sentezlenir, böylece yükleme gecikmesi ve telif sorunu olmaz.
 */
export type Sfx = 'shot' | 'hit' | 'kill' | 'hurt' | 'ui' | 'wave' | 'alarm' | 'buy' | 'deny' | 'reload' | 'reloadComplete'

export class Audio {
  readonly ctx: AudioContext
  private master: GainNode
  private music: GainNode
  private sfx: GainNode
  private noise: AudioBuffer
  private musicTimer = 0
  private musicOn = false
  private engineGain?: GainNode
  private engineFilter?: BiquadFilterNode
  private engineOsc?: OscillatorNode
  private windGain?: GainNode
  private lastShot = 0

  constructor() {
    this.ctx = new AudioContext()
    this.master = this.ctx.createGain()
    this.music = this.ctx.createGain()
    this.sfx = this.ctx.createGain()
    this.music.connect(this.master)
    this.sfx.connect(this.master)
    this.master.connect(this.ctx.destination)
    this.noise = this.makeNoise()
  }

  unlock(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }

  /** Ses seviyeleri 0..1. */
  setVolumes(music: number, sfx: number, muted = false): void {
    const t = this.ctx.currentTime
    this.music.gain.setTargetAtTime(muted ? 0 : music * 0.5, t, 0.05)
    this.sfx.gain.setTargetAtTime(muted ? 0 : sfx * 0.85, t, 0.05)
  }

  private makeNoise(): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * 1.2)
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
    return buffer
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, gain: number, q = 1, delay = 0): void {
    const t = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    const filter = this.ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.setValueAtTime(freq, t)
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, freq * 0.35), t + dur)
    filter.Q.value = q
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(filter).connect(g).connect(this.sfx)
    src.start(t)
    src.stop(t + dur + 0.05)
  }

  private tone(freq: number, end: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
    const t = this.ctx.currentTime + delay
    const o = this.ctx.createOscillator()
    const g = this.ctx.createGain()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(end, 20), t + dur)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.sfx)
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  play(name: Sfx): void {
    if (this.ctx.state !== 'running') return
    switch (name) {
      case 'shot': {
        // Namlu: kısa gürültü patlaması + gövde tıkırtısı. Çok hızlı ateşte üst üste binmesin.
        const now = this.ctx.currentTime
        if (now - this.lastShot < 0.035) return
        this.lastShot = now
        this.burst(0.09, 'highpass', 2400, 0.5, 0.7)
        this.burst(0.14, 'bandpass', 900, 0.32, 1.2)
        this.tone(180, 60, 0.1, 'square', 0.16)
        break
      }
      case 'hit':
        this.tone(1480, 1180, 0.05, 'square', 0.16)
        this.burst(0.05, 'bandpass', 3200, 0.18, 2)
        break
      case 'kill':
        this.burst(0.55, 'lowpass', 900, 0.5, 0.8)
        this.tone(120, 38, 0.6, 'sawtooth', 0.22)
        this.tone(320, 90, 0.35, 'triangle', 0.1, 0.04)
        break
      case 'hurt':
        this.burst(0.3, 'lowpass', 700, 0.42, 0.9)
        this.tone(220, 70, 0.35, 'sawtooth', 0.24)
        break
      case 'ui':
        this.tone(760, 820, 0.05, 'triangle', 0.14)
        break
      case 'reload':
        this.tone(520, 260, 0.16, 'square', 0.11)
        this.tone(340, 420, 0.14, 'triangle', 0.09, 0.08)
        break
      case 'reloadComplete':
        this.tone(520, 780, 0.12, 'triangle', 0.12)
        this.tone(780, 980, 0.1, 'sine', 0.09, 0.07)
        break
      case 'wave':
        [523, 659, 784].forEach((f, i) => this.tone(f, f * 1.01, 0.22, 'triangle', 0.16, i * 0.1))
        break
      case 'alarm':
        this.tone(880, 620, 0.16, 'square', 0.12)
        this.tone(880, 620, 0.16, 'square', 0.12, 0.22)
        break
      case 'buy':
        this.tone(660, 990, 0.14, 'triangle', 0.18)
        this.tone(990, 1320, 0.18, 'sine', 0.12, 0.08)
        break
      case 'deny':
        this.tone(180, 120, 0.18, 'square', 0.14)
        break
    }
  }

  /** Motor uğultusu + pervane rüzgârı; `power` 0..1 itki, `speed` 0..1 hız. */
  setEngine(power: number, speed: number): void {
    if (this.ctx.state !== 'running') return
    const t = this.ctx.currentTime
    if (!this.engineGain) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      const filter = this.ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 420
      filter.Q.value = 0.8
      const gain = this.ctx.createGain()
      gain.gain.value = 0.0001
      src.connect(filter).connect(gain).connect(this.sfx)
      src.start()
      const osc = this.ctx.createOscillator()
      osc.type = 'sawtooth'
      osc.frequency.value = 78
      const oscGain = this.ctx.createGain()
      oscGain.gain.value = 0.06
      osc.connect(oscGain).connect(gain)
      osc.start()
      this.engineGain = gain
      this.engineFilter = filter
      this.engineOsc = osc

      const windSrc = this.ctx.createBufferSource()
      windSrc.buffer = this.noise
      windSrc.loop = true
      const windFilter = this.ctx.createBiquadFilter()
      windFilter.type = 'highpass'
      windFilter.frequency.value = 900
      const windGain = this.ctx.createGain()
      windGain.gain.value = 0.0001
      windSrc.connect(windFilter).connect(windGain).connect(this.sfx)
      windSrc.start()
      this.windGain = windGain
    }
    this.engineGain.gain.setTargetAtTime(0.05 + power * 0.11, t, 0.08)
    this.engineFilter?.frequency.setTargetAtTime(360 + power * 520 + speed * 260, t, 0.1)
    this.engineOsc?.frequency.setTargetAtTime(66 + power * 42 + speed * 26, t, 0.12)
    this.windGain?.gain.setTargetAtTime(speed * 0.05, t, 0.12)
  }

  /** Endüstriyel nabız: düşük bas hattı ve perküsyon, 4 vuruşluk döngü. */
  startMusic(): void {
    if (this.musicOn) return
    this.musicOn = true
    const bass = [55, 55, 73.4, 61.7]
    let step = 0
    const schedule = () => {
      if (!this.musicOn) return
      const t = this.ctx.currentTime + 0.05
      const f = bass[step % bass.length]
      const o = this.ctx.createOscillator()
      const g = this.ctx.createGain()
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 320
      o.type = 'sawtooth'
      o.frequency.value = f
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.07, t + 0.08)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85)
      o.connect(lp).connect(g).connect(this.music)
      o.start(t)
      o.stop(t + 0.95)
      if (step % 2 === 0) {
        const kick = this.ctx.createOscillator()
        const kg = this.ctx.createGain()
        kick.type = 'sine'
        kick.frequency.setValueAtTime(110, t)
        kick.frequency.exponentialRampToValueAtTime(38, t + 0.18)
        kg.gain.setValueAtTime(0.16, t)
        kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
        kick.connect(kg).connect(this.music)
        kick.start(t)
        kick.stop(t + 0.26)
      }
      step += 1
      this.musicTimer = window.setTimeout(schedule, 460)
    }
    schedule()
  }

  stopMusic(): void {
    this.musicOn = false
    clearTimeout(this.musicTimer)
  }
}
