export const BUILD = 'rotor-strike-pvp-v1'

export type PilotPose = {
  type: 'pose'
  build: string
  seat: string
  seq: number
  name: string
  drone: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  yaw: number
  pitch: number
  roll: number
  hp: number
  ammo: number
}

export type NetState = 'idle' | 'connecting' | 'online' | 'retry' | 'unavailable' | 'full'
export type NetHooks = {
  state(state: NetState, detail?: string): void
  message(message: Record<string, unknown>): void
}

export function cleanNickname(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18)
}

export function cleanRoom(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
}

export function newRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map(n => alphabet[n % alphabet.length]).join('')
}

const resumeKey = (room: string) => `rotorstrike.resume.${room}`

export class MultiplayerClient {
  state: NetState = 'idle'
  room = ''
  nickname = ''
  seat = ''
  private socket?: WebSocket
  private seq = 0
  private stopped = false
  private generation = 0
  private retryTimer = 0
  private endpoint = ''
  private retryMs = 1000

  constructor(private readonly hooks: NetHooks) {}

  async connect(room: string, nickname: string): Promise<void> {
    this.disconnect()
    this.stopped = false
    this.generation += 1
    const generation = this.generation
    this.room = cleanRoom(room)
    this.nickname = cleanNickname(nickname)
    if (this.room.length !== 6 || !this.nickname) {
      this.setState('unavailable', 'nickname_or_room')
      return
    }
    this.setState('connecting')
    try {
      const page = new URL(location.href)
      const marker = page.pathname.indexOf('/__manus__/game-preview/')
      if (marker >= 0) page.pathname = page.pathname.slice(0, marker + 1)
      page.search = ''
      page.hash = ''
      const bootstrap = new URL('multiplayer/bootstrap.json', page)
      const response = await fetch(bootstrap, { cache: 'no-store' })
      if (!response.ok) throw new Error('bootstrap')
      const cfg = await response.json() as { version?: number; build?: string; signalingUrl?: string }
      if (generation !== this.generation) return
      if (cfg.version !== 1 || cfg.build !== BUILD || typeof cfg.signalingUrl !== 'string') throw new Error('bootstrap')
      const endpoint = new URL(cfg.signalingUrl)
      if (endpoint.protocol !== 'wss:' || endpoint.pathname !== '/ws' || endpoint.username || endpoint.password) throw new Error('endpoint')
      this.endpoint = endpoint.href
      this.open(generation)
    } catch {
      if (generation === this.generation) this.setState('unavailable', 'not_configured')
    }
  }

  sendPose(pose: Omit<PilotPose, 'type' | 'build' | 'seat' | 'seq' | 'name'>): void {
    if (this.state !== 'online') return
    this.send({ type: 'pose', build: BUILD, seq: ++this.seq, ...pose })
  }

  fire(origin: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }): void {
    if (this.state !== 'online') return
    this.send({ type: 'fire', build: BUILD, origin, direction, at: Date.now() })
  }

  disconnect(): void {
    this.stopped = true
    this.generation += 1
    if (this.retryTimer) window.clearTimeout(this.retryTimer)
    this.retryTimer = 0
    const socket = this.socket
    this.socket = undefined
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000)
    }
    this.seat = ''
    this.setState('idle')
  }

  private open(generation: number): void {
    if (this.stopped || generation !== this.generation) return
    let resume = ''
    try { resume = sessionStorage.getItem(resumeKey(this.room)) ?? '' } catch { /* private browsing */ }
    const url = new URL(this.endpoint)
    url.searchParams.set('room', this.room)
    if (resume) url.searchParams.set('resume', resume)
    const ws = new WebSocket(url)
    this.socket = ws
    this.setState('connecting')
    ws.onopen = () => {
      if (generation !== this.generation) return
      this.retryMs = 1000
      ws.send(JSON.stringify({ type: 'join', build: BUILD, nickname: this.nickname }))
    }
    ws.onmessage = event => {
      if (generation !== this.generation || typeof event.data !== 'string' || event.data.length > 8192) return
      let message: Record<string, unknown>
      try { message = JSON.parse(event.data) as Record<string, unknown> } catch { return }
      if (message.build !== BUILD || message.room !== this.room || typeof message.type !== 'string') return
      if (message.type === 'welcome') {
        if (typeof message.resume !== 'string' || typeof message.seat !== 'string') return
        this.seat = message.seat
        try { sessionStorage.setItem(resumeKey(this.room), message.resume) } catch { /* private browsing */ }
        this.setState('online')
      }
      if (message.type === 'error' && message.code === 'room_full') this.setState('full')
      this.hooks.message(message)
    }
    ws.onclose = event => {
      if (generation !== this.generation || this.stopped) return
      if (event.code === 1008) { this.setState('full'); return }
      this.setState('retry')
      this.retryTimer = window.setTimeout(() => this.open(generation), this.retryMs)
      this.retryMs = Math.min(8000, this.retryMs * 1.7)
    }
    ws.onerror = () => { /* onclose owns retry */ }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ room: this.room, ...message }))
  }

  private setState(state: NetState, detail?: string): void {
    this.state = state
    this.hooks.state(state, detail)
  }
}
