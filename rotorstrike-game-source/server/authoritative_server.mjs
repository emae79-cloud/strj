import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

const BUILD = 'rotor-strike-pvp-v2'
const PORT = Number(process.env.PORT || 10000)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_ROOMS = 256
const MAX_CLIENTS = 512
const MAX_BYTES = 8192
const MAX_MESSAGES_PER_SECOND = 45
const FIRE_RATE = 8.5
const HIT_RADIUS = 1.35
const MAX_PITCH = 1.1
const MAGAZINE_SIZE = 28
const RELOAD_MS = 5000
const ROOM_IDLE_MS = 10 * 60_000
const MAX_POSITION = 260
const MAX_SPEED = 180
const MAX_SHOT_RANGE = 300
const MAX_NICKNAME = 18
// Keep these rules in sync with src/game/hangar.ts. The server allows the highest
// legal weapon upgrade (level 4: 1 + 4 × 0.08), but never exceeds 8.5 shots/second.
const DRONE_WEAPONS = {
  rq1: { kind: 'machinegun', fireRate: 8.5, fireRateStat: 1, range: 280, rangeStat: 1 },
  sk2: { kind: 'pulse', fireRate: 6.5, fireRateStat: 1.05, range: 300, rangeStat: 0.9 },
  tb3: { kind: 'cannon', fireRate: 5, fireRateStat: 1, range: 240, rangeStat: 1.05 },
  ac4: { kind: 'autocannon', fireRate: 5.5, fireRateStat: 1.45, range: 260, rangeStat: 1.15 },
  vx5: { kind: 'rapid-pulse', fireRate: 6.5, fireRateStat: 1.2, range: 250, rangeStat: 0.95 },
  pr6: { kind: 'homing-missile', fireRate: 1.25, fireRateStat: 1.32, range: 250, rangeStat: 1.2 },
}
const origins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean))
const rooms = new Map()
const finite = Number.isFinite
const token = () => randomBytes(24).toString('base64url')

function weaponRules(drone) {
  const profile = DRONE_WEAPONS[drone] || DRONE_WEAPONS.rq1
  return {
    kind: profile.kind,
    fireRate: Math.min(FIRE_RATE, profile.fireRate * profile.fireRateStat * 1.32),
    range: Math.min(MAX_SHOT_RANGE, profile.range * profile.rangeStat),
  }
}

function safeName(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NICKNAME)
}
function safeRoom(value) {
  return typeof value === 'string' && /^[A-Z0-9]{6}$/.test(value) ? value : ''
}
function send(ws, data) {
  if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 64 * 1024) ws.send(JSON.stringify(data))
}
function cleanPose(m) {
  const values = [m.x, m.y, m.z, m.vx, m.vy, m.vz, m.yaw, m.pitch, m.roll]
  if (!values.every(finite) || Math.abs(m.x) > MAX_POSITION || Math.abs(m.z) > MAX_POSITION || m.y < 1 || m.y > 205) return false
  if (Math.abs(m.pitch) > MAX_PITCH || Math.abs(m.yaw) > 201 || Math.abs(m.roll) > 201 || Math.hypot(m.vx, m.vy, m.vz) > MAX_SPEED) return false
  return typeof m.drone === 'string' && Object.hasOwn(DRONE_WEAPONS, m.drone) && Number.isSafeInteger(m.seq) && m.seq >= 0
}
function raySphere(origin, direction, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z
  const b = ox * direction.x + oy * direction.y + oz * direction.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t >= 0 ? t : null
}
function snapshot(room) {
  return { type: 'room', build: BUILD, room: room.code, players: [...room.seats.values()].filter(s => s.ws?.readyState === WebSocket.OPEN).map(s => ({ seat: s.id, name: s.name, drone: s.drone, hp: s.hp, ammo: s.ammo, x: s.pose.x, y: s.pose.y, z: s.pose.z, vx: s.pose.vx || 0, vy: s.pose.vy || 0, vz: s.pose.vz || 0, yaw: s.pose.yaw, pitch: s.pose.pitch, roll: s.pose.roll })) }
}
function broadcast(room) {
  const packet = JSON.stringify(snapshot(room))
  for (const seat of room.seats.values()) if (seat.ws?.readyState === WebSocket.OPEN && seat.ws.bufferedAmount < 64 * 1024) seat.ws.send(packet)
}
function roomFor(code) {
  let room = rooms.get(code)
  if (!room) {
    if (rooms.size >= MAX_ROOMS) return null
    room = { code, seats: new Map(), last: Date.now() }
    rooms.set(code, room)
  }
  return room
}
function detach(ws) {
  const room = ws.room
  if (!room || !ws.seat) return
  const seat = room.seats.get(ws.seat)
  if (seat?.ws === ws) { seat.ws = null; seat.disconnected = Date.now() }
  room.last = Date.now()
  broadcast(room)
  ws.room = null
}

const http = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ ok: true, build: BUILD, rooms: rooms.size, uptime: Math.floor(process.uptime()) }))
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('Not found')
})
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES })
http.on('upgrade', (req, socket, head) => {
  let url
  try { url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`) } catch { socket.destroy(); return }
  const origin = req.headers.origin
  const sameOrigin = origin && (() => { try { return new URL(origin).host === req.headers.host } catch { return false } })()
  if (wss.clients.size >= MAX_CLIENTS || (origin && !sameOrigin && !origins.has(origin)) || url.pathname !== '/ws' || !safeRoom(url.searchParams.get('room'))) { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, url))
})

wss.on('connection', (ws, url) => {
  ws.alive = true
  ws.on('pong', () => { ws.alive = true })
  let messageWindow = Date.now(), messageCount = 0
  ws.on('message', raw => {
    const now = Date.now()
    if (now - messageWindow >= 1000) { messageWindow = now; messageCount = 0 }
    if (++messageCount > MAX_MESSAGES_PER_SECOND || raw.length > MAX_BYTES) { ws.close(1008, 'rate limited'); return }
    let m
    try { m = JSON.parse(raw.toString()) } catch { send(ws, { type: 'error', build: BUILD, code: 'invalid_message' }); return }
    if (!m || m.build !== BUILD || typeof m.type !== 'string') { send(ws, { type: 'error', build: BUILD, code: 'build_mismatch' }); return }
    if (m.type === 'join' && !ws.room) {
      const roomCode = safeRoom(url.searchParams.get('room'))
      const name = safeName(m.nickname)
      if (!roomCode || !name) { send(ws, { type: 'error', build: BUILD, code: 'invalid_nickname' }); ws.close(1008, 'invalid nickname'); return }
      const room = roomFor(roomCode)
      if (!room) { send(ws, { type: 'error', build: BUILD, room: roomCode, code: 'room_limit' }); ws.close(1008, 'room limit'); return }
      let seat = [...room.seats.values()].find(s => s.token === url.searchParams.get('resume') && s.disconnected && now - s.disconnected < 60_000)
      if (seat) { if (seat.ws && seat.ws !== ws) seat.ws.close(4001, 'seat resumed elsewhere'); seat.ws = ws; seat.disconnected = 0; seat.poseAt = 0; seat.seq = -1; seat.name = name }
      else {
        if (room.seats.size >= 2) { send(ws, { type: 'error', build: BUILD, room: roomCode, code: 'room_full' }); ws.close(1008, 'room full'); return }
        const seatId = room.seats.has('p1') ? 'p2' : 'p1'
        seat = { id: seatId, token: token(), ws, name, drone: 'rq1', hp: 4, ammo: MAGAZINE_SIZE, reloadUntil: 0, lastFire: 0, poseAt: 0, pose: { x: 0, y: 42, z: 96, yaw: 0, pitch: 0, roll: 0 }, seq: -1, disconnected: 0 }
        room.seats.set(seat.id, seat)
      }
      ws.room = room; ws.seat = seat.id; room.last = now
      send(ws, { type: 'welcome', build: BUILD, room: room.code, seat: seat.id, resume: seat.token, hp: seat.hp, ammo: seat.ammo, fireRate: FIRE_RATE, magazineSize: MAGAZINE_SIZE, reloadMs: RELOAD_MS })
      broadcast(room)
      return
    }
    const room = ws.room, seat = room?.seats.get(ws.seat)
    if (!room || !seat || seat.ws !== ws) return
    if (m.room !== room.code) return
    room.last = now
    if (m.type === 'pose') {
      if (!cleanPose(m) || m.seq <= seat.seq || now - seat.poseAt < 25) return
      const previous = seat.pose
      const dt = Math.max(0.025, Math.min(2, (now - seat.poseAt) / 1000))
      if (seat.poseAt && Math.hypot(m.x - previous.x, m.y - previous.y, m.z - previous.z) / dt > MAX_SPEED) return
      seat.seq = m.seq; seat.poseAt = now
      seat.pose = { x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, yaw: m.yaw, pitch: m.pitch, roll: m.roll }
      seat.drone = m.drone
      // Client does not own health or ammunition; ignore their claimed values.
      broadcast(room)
      return
    }
    if (m.type === 'fire') {
      if (!m.origin || !m.direction || ![m.origin.x,m.origin.y,m.origin.z,m.direction.x,m.direction.y,m.direction.z].every(finite)) return
      const dirLen = Math.hypot(m.direction.x,m.direction.y,m.direction.z)
      const weapon = weaponRules(seat.drone)
      if (Math.abs(dirLen - 1) > 0.08 || now - seat.lastFire < 1000 / weapon.fireRate - 2 || now < seat.reloadUntil || seat.ammo <= 0) return
      const originDist = Math.hypot(m.origin.x-seat.pose.x,m.origin.y-seat.pose.y,m.origin.z-seat.pose.z)
      if (originDist > 4) return
      let homingTarget = null
      let homingDistance = 0
      let homingLockPosition = null
      if (weapon.kind === 'homing-missile') {
        if (m.blocked === true || typeof m.targetSeat !== 'string') return
        homingTarget = room.seats.get(m.targetSeat)
        if (!homingTarget || homingTarget === seat || homingTarget.ws?.readyState !== WebSocket.OPEN || homingTarget.hp <= 0 || now - homingTarget.poseAt > 1000) return
        const dx = homingTarget.pose.x - m.origin.x, dy = homingTarget.pose.y - m.origin.y, dz = homingTarget.pose.z - m.origin.z
        homingDistance = Math.hypot(dx, dy, dz)
        const alignment = (dx * m.direction.x + dy * m.direction.y + dz * m.direction.z) / Math.max(1e-6, homingDistance * dirLen)
        if (homingDistance > weapon.range || alignment < Math.cos(Math.PI / 12)) return
        homingLockPosition = { x: homingTarget.pose.x, y: homingTarget.pose.y, z: homingTarget.pose.z }
      }
      seat.lastFire = now; seat.ammo -= 1
      if (seat.ammo === 0) {
        const deadline = now + RELOAD_MS
        seat.reloadUntil = deadline
        setTimeout(() => {
          if (seat.reloadUntil !== deadline || seat.ammo !== 0) return
          seat.reloadUntil = 0; seat.ammo = MAGAZINE_SIZE
          send(seat.ws, { type: 'ammo', build: BUILD, room: room.code, ammo: MAGAZINE_SIZE })
          broadcast(room)
        }, RELOAD_MS)
      }
      if (weapon.kind === 'homing-missile' && homingTarget && homingLockPosition) {
        const missileId = token()
        const durationMs = Math.max(650, Math.min(1800, Math.round(homingDistance / 150 * 1000)))
        const from = { x: m.origin.x, y: m.origin.y, z: m.origin.z }
        const direction = { x: m.direction.x / dirLen, y: m.direction.y / dirLen, z: m.direction.z / dirLen }
        for (const recipient of room.seats.values()) send(recipient.ws, { type: 'missile', build: BUILD, room: room.code, id: missileId, ownerSeat: seat.id, targetSeat: homingTarget.id, from, direction, durationMs })
        send(ws, { type: 'shot', build: BUILD, room: room.code, ammo: seat.ammo, reloadMs: Math.max(0, seat.reloadUntil - now), hit: false })
        broadcast(room)
        setTimeout(() => {
          const current = room.seats.get(homingTarget.id)
          const moved = current ? Math.hypot(current.pose.x - homingLockPosition.x, current.pose.y - homingLockPosition.y, current.pose.z - homingLockPosition.z) : Infinity
          const distanceNow = current ? Math.hypot(current.pose.x - from.x, current.pose.y - from.y, current.pose.z - from.z) : Infinity
          const hit = current === homingTarget && current.ws?.readyState === WebSocket.OPEN && current.hp > 0 && Date.now() - current.poseAt <= 1000 && moved <= 55 && distanceNow <= weapon.range * 1.2
          const position = hit ? { x: current.pose.x, y: current.pose.y, z: current.pose.z } : { x: from.x + direction.x * Math.min(weapon.range, homingDistance), y: from.y + direction.y * Math.min(weapon.range, homingDistance), z: from.z + direction.z * Math.min(weapon.range, homingDistance) }
          for (const recipient of room.seats.values()) send(recipient.ws, { type: 'missileImpact', build: BUILD, room: room.code, id: missileId, position, hit })
          if (hit) {
            current.hp = Math.max(0, current.hp - 1)
            send(current.ws, { type: 'damage', build: BUILD, room: room.code, hp: current.hp, from: seat.id })
            if (current.hp === 0) {
              send(current.ws, { type: 'down', build: BUILD, room: room.code, by: seat.id })
              setTimeout(() => { current.hp = 4; current.ammo = MAGAZINE_SIZE; if (current.ws?.readyState === WebSocket.OPEN) { send(current.ws, { type: 'respawn', build: BUILD, room: room.code, hp: 4, ammo: MAGAZINE_SIZE }); broadcast(room) } }, 2500)
            }
          }
          broadcast(room)
        }, durationMs)
        return
      }
      const target = [...room.seats.values()].find(other => other !== seat && other.ws?.readyState === WebSocket.OPEN)
      let hit = false
      if (target && m.blocked !== true) {
        const p = target.pose
        const distance = raySphere(m.origin, m.direction, p, HIT_RADIUS)
        if (distance !== null && distance <= weapon.range && now - target.poseAt <= 500) {
          target.hp = Math.max(0, target.hp - 1); hit = true
          send(target.ws, { type: 'damage', build: BUILD, room: room.code, hp: target.hp, from: seat.id })
          if (target.hp === 0) {
            send(target.ws, { type: 'down', build: BUILD, room: room.code, by: seat.id })
            setTimeout(() => { target.hp = 4; target.ammo = MAGAZINE_SIZE; if (target.ws?.readyState === WebSocket.OPEN) { send(target.ws, { type: 'respawn', build: BUILD, room: room.code, hp: 4, ammo: MAGAZINE_SIZE }); broadcast(room) } }, 2500)
          }
        }
      }
      send(ws, { type: 'shot', build: BUILD, room: room.code, ammo: seat.ammo, reloadMs: Math.max(0, seat.reloadUntil - now), hit })
      broadcast(room)
    }
  })
  ws.on('close', () => detach(ws))
  ws.on('error', () => detach(ws))
})

setInterval(() => {
  for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping() } }
  const now = Date.now()
  for (const [code, room] of rooms) {
    for (const [id, seat] of room.seats) {
      if (seat.disconnected && now - seat.disconnected > 60_000) room.seats.delete(id)
      if (seat.reloadUntil && now >= seat.reloadUntil) { seat.reloadUntil = 0; seat.ammo = MAGAZINE_SIZE; send(seat.ws, { type: 'ammo', build: BUILD, room: room.code, ammo: MAGAZINE_SIZE }); broadcast(room) }
    }
    if (room.seats.size === 0 && now - room.last > ROOM_IDLE_MS) rooms.delete(code)
  }
}, 15_000).unref()

http.listen(PORT, HOST, () => console.log(JSON.stringify({ status: 'listening', build: BUILD, host: HOST, port: PORT })))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const ws of wss.clients) ws.close(1012, 'server restart'); http.close(() => process.exit(0)); setTimeout(() => process.exit(1), 3000).unref() })
