// End-to-end smoke test: build must already exist in dist/ (`pnpm build`).
// Serves dist/, boots the game in headless Chromium, checks flight, reload and controls,
// walks the screens, ends a run through real damage rules, and fails on console/page/network errors.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const port = 4300 + Math.floor(Math.random() * 500)
const url = `http://127.0.0.1:${port}/`
const out = process.env.SHOTS_DIR ?? 'shots'
mkdirSync(out, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: false })
let browser
const guard = setTimeout(() => fail('timed out'), 150_000)

function cleanup() {
  clearTimeout(guard)
  try { server.kill('SIGTERM') } catch {}
}
async function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`)
  await browser?.close().catch(() => {})
  cleanup()
  process.exit(1)
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('preview server did not start')
}

async function openGame(context, errors) {
  const page = await context.newPage()
  page.on('console', m => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', e => errors.push(String(e)))
  page.on('response', r => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
  await page.goto(url)
  await page.waitForSelector('[data-screen="title"].is-active', { timeout: 40_000 })
  await page.evaluate(async () => {
    await document.fonts.ready
    if (document.documentElement.lang !== 'tr') throw new Error(`expected tr lang, got ${document.documentElement.lang}`)
    const loaded = [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family.replaceAll('"', '').replaceAll("'", ''))
    if (!loaded.some(family => family.startsWith('Barlow'))) throw new Error(`bundled Barlow font did not load (${loaded.join(', ')})`)
    const title = document.querySelector('[data-screen="title"] .logo-text') ?? document.querySelector('[data-screen="title"] h1')
    if (!title || !title.textContent.toUpperCase().includes('ROTOR')) throw new Error('title copy missing')
  })
  await page.waitForTimeout(900)
  return page
}

const state = page => page.evaluate(() => {
  const { game } = window.__game
  const p = game['player']?.position ?? { x: 0, y: 0, z: 0 }
  return { mode: game.mode, hud: game.hud(), pos: { x: p.x, y: p.y, z: p.z }, phase: game['run'].phase }
})

try {
  await waitForServer()
  const args = ['--ignore-gpu-blocklist']
  browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }))
  const errors = []

  // Desktop: automatic mode must not expose Android controls.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'tr-TR' })
  const page = await openGame(ctx, errors)
  await page.screenshot({ path: `${out}/01-title.png` })
  const desktopStart = await page.evaluate(() => {
    const { input, save } = window.__game
    return { controlMode: save.data.controlMode, touchEnabled: input.touchEnabled, display: getComputedStyle(document.querySelector('.touch')).display }
  })
  if (desktopStart.controlMode !== 'auto' || desktopStart.touchEnabled || desktopStart.display !== 'none') {
    throw new Error(`desktop auto controls incorrect: ${JSON.stringify(desktopStart)}`)
  }

  await page.click('[data-screen="title"] [data-action="play"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await page.waitForTimeout(500)
  const before = await state(page)
  if (before.hud.hp !== 4 || before.hud.maxHp !== 4) throw new Error(`expected four drone lives, got ${before.hud.hp}/${before.hud.maxHp}`)
  if (before.hud.ammo !== 20 || before.hud.magazineSize !== 20) throw new Error(`expected a full 20-round magazine, got ${before.hud.ammo}/${before.hud.magazineSize}`)

  // Headless software rendering runs at a couple of frames per second, so drive the same fixed
  // 60 Hz simulation the loop uses instead of relying on wall-clock frames.
  const run = steps => page.evaluate(n => {
    const { game: g, input } = window.__game
    for (let i = 0; i < n; i += 1) {
      input.update(1 / 60)
      g.step(1 / 60)
    }
    return { hud: g.hud() }
  }, steps)

  // Fly forward, climb, then fire a short burst.
  await page.keyboard.down('KeyW')
  await run(32)
  await page.keyboard.down('Space')
  await run(40)
  await page.keyboard.up('Space')
  await page.keyboard.down('KeyF')
  const firing = await run(35)
  await page.keyboard.up('KeyF')
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(1400)
  await page.screenshot({ path: `${out}/02-gameplay.png` })
  const after = await state(page)

  const moved = Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z)
  if (after.mode !== 'playing') throw new Error(`expected playing, got ${after.mode}`)
  if (!(firing.hud.ammo < firing.hud.magazineSize)) throw new Error(`weapon did not consume magazine ammo (${firing.hud.ammo}/${firing.hud.magazineSize})`)
  if (!(after.hud.credits >= 0)) throw new Error('credit readout missing')
  if (moved < 2) throw new Error(`drone barely moved (${moved.toFixed(2)} m)`)
  if (!(firing.hud.speed > 1)) throw new Error(`speed readout stuck at ${firing.hud.speed}`)
  console.log(`smoke: moved ${moved.toFixed(1)} m, speed ${firing.hud.speed.toFixed(1)}, ammo ${firing.hud.ammo}/${firing.hud.magazineSize}, hp ${after.hud.hp}/${after.hud.maxHp}`)

  // Empty a fresh full magazine with the real firing path, then prove it remains empty for
  // 299/300 fixed ticks and is refilled on exactly the 300th tick (5.0 seconds at 60 Hz).
  await page.keyboard.down('KeyF')
  const magazine = await page.evaluate(() => {
    const { game: g, input, ui } = window.__game
    const p = g['player']
    p.ammo = 20
    p.reloadRemaining = 0
    p['fireCooldown'] = 0
    g['invuln'] = 1000
    let stepsToEmpty = 0
    while (g.hud().ammo > 0 && stepsToEmpty < 1000) {
      input.update(1 / 60)
      g.step(1 / 60)
      stepsToEmpty += 1
    }
    const reloadStart = g.hud()
    ui.updateHud(reloadStart)
    const reloadVisibleAtStart = document.querySelector('.hud-ammo').classList.contains('is-reloading')
    const reloadTextAtStart = document.querySelector('[data-slot="reload"]').textContent
    const ammoTextAtStart = document.querySelector('[data-slot="ammo"]').textContent
    const ticks = Math.round(reloadStart.reloadDuration * 60)
    for (let i = 0; i < ticks - 1; i += 1) {
      input.update(1 / 60)
      g.step(1 / 60)
    }
    const oneTickBefore = g.hud()
    ui.updateHud(oneTickBefore)
    input.update(1 / 60)
    g.step(1 / 60)
    const reloaded = g.hud()
    ui.updateHud(reloaded)
    return {
      stepsToEmpty,
      reloadStart: { ammo: reloadStart.ammo, remaining: reloadStart.reloadRemaining, duration: reloadStart.reloadDuration },
      reloadVisibleAtStart,
      reloadTextAtStart,
      ammoTextAtStart,
      oneTickBefore: { ammo: oneTickBefore.ammo, remaining: oneTickBefore.reloadRemaining },
      reloaded: { ammo: reloaded.ammo, remaining: reloaded.reloadRemaining, classActive: document.querySelector('.hud-ammo').classList.contains('is-reloading'), text: document.querySelector('[data-slot="reload"]').textContent },
    }
  })
  await page.keyboard.up('KeyF')
  if (magazine.stepsToEmpty < 200 || magazine.stepsToEmpty > 300) throw new Error(`20-shot magazine did not empty at a plausible 5 Hz cadence: ${JSON.stringify(magazine)}`)
  if (magazine.reloadStart.ammo !== 0 || magazine.reloadStart.remaining !== 5 || magazine.reloadStart.duration !== 5) {
    throw new Error(`reload did not start empty with an exact 5-second timer: ${JSON.stringify(magazine.reloadStart)}`)
  }
  if (!magazine.reloadVisibleAtStart || !magazine.reloadTextAtStart.includes('DOLDURULUYOR') || magazine.ammoTextAtStart !== '0 / 20') {
    throw new Error(`reload HUD was not visible and accurate: ${JSON.stringify(magazine)}`)
  }
  if (magazine.oneTickBefore.ammo !== 0 || !(magazine.oneTickBefore.remaining > 0)) {
    throw new Error(`magazine refilled before five seconds elapsed: ${JSON.stringify(magazine.oneTickBefore)}`)
  }
  if (magazine.reloaded.ammo !== 20 || magazine.reloaded.remaining !== 0 || magazine.reloaded.classActive || magazine.reloaded.text !== '') {
    throw new Error(`magazine was not restored after exactly 5 seconds: ${JSON.stringify(magazine.reloaded)}`)
  }
  console.log(`smoke: 20-round magazine reloaded exactly after ${magazine.reloadStart.duration.toFixed(1)} seconds`)

  // Control setting is persistent and changes both the touch layer and input gating.
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(350)
  await page.screenshot({ path: `${out}/03-pause.png` })
  await page.click('[data-screen="pause"] [data-action="settings"]')
  await page.waitForSelector('[data-screen="settings"].is-active')
  await page.waitForTimeout(350)
  await page.locator('[data-setting="controlMode"] [data-value="android"]').click()
  const androidSelected = await page.evaluate(() => {
    const { input, save } = window.__game
    return { mode: save.data.controlMode, touchEnabled: input.touchEnabled, show: document.body.classList.contains('show-mobile-controls') }
  })
  if (androidSelected.mode !== 'android' || !androidSelected.touchEnabled || !androidSelected.show) {
    throw new Error(`Android selection did not enable touch controls: ${JSON.stringify(androidSelected)}`)
  }
  await page.locator('[data-setting="controlMode"] [data-value="pc"]').click()
  const pcSelected = await page.evaluate(() => {
    const { input, save } = window.__game
    return { mode: save.data.controlMode, touchEnabled: input.touchEnabled, show: document.body.classList.contains('show-mobile-controls'), display: getComputedStyle(document.querySelector('.touch')).display }
  })
  if (pcSelected.mode !== 'pc' || pcSelected.touchEnabled || pcSelected.show || pcSelected.display !== 'none') {
    throw new Error(`PC selection did not hide/disable touch controls: ${JSON.stringify(pcSelected)}`)
  }
  await page.screenshot({ path: `${out}/04-settings.png` })
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-screen="pause"].is-active')
  await page.waitForTimeout(250)
  if ((await state(page)).mode !== 'paused') throw new Error('leaving Settings with Escape resumed the run')

  // End the run through the real damage path: four hits remove the four lives.
  await page.click('[data-screen="pause"] [data-action="resume"]')
  await page.waitForSelector('[data-screen="hud"].is-active')
  await page.evaluate(() => {
    const { game } = window.__game
    for (let i = 0; i < 8; i += 1) {
      const pos = game['player'].position.clone()
      game['invuln'] = 0
      game['onEnemyFire']({ from: pos.clone().add({ x: 0, y: 0, z: -60 }), hitChance: 1 }, pos)
      if (game['run'].phase === 'ended') break
    }
    // The end hook fires from the next simulation step.
    window.__game.input.update(1 / 60)
    game.step(1 / 60)
  })
  await page.waitForSelector('[data-screen="results"].is-active', { timeout: 10_000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/05-results.png` })
  const done = await state(page)
  if (done.phase !== 'ended') throw new Error(`expected an ended run, got ${done.phase}`)
  if (done.hud.hp !== 0) throw new Error(`expected 0 hp at the end, got ${done.hud.hp}`)

  await page.click('[data-screen="results"] [data-action="quit"]')
  await page.waitForSelector('[data-screen="title"].is-active')
  await page.click('[data-screen="title"] [data-action="hangar"]')
  await page.waitForSelector('[data-screen="hangar"].is-active')
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/06-hangar.png` })
  const cards = await page.locator('[data-screen="hangar"] [data-drone]').count()
  if (cards < 6) throw new Error(`expected at least 6 drones in the hangar, found ${cards}`)
  await ctx.close()

  // Android emulation: automatic detection turns on the layer and touch movement affects flight.
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'tr-TR',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  })
  const phonePage = await openGame(phone, errors)
  const phoneAuto = await phonePage.evaluate(() => {
    const { input, save } = window.__game
    return { mode: save.data.controlMode, touchEnabled: input.touchEnabled, show: document.body.classList.contains('show-mobile-controls') }
  })
  if (phoneAuto.mode !== 'auto' || !phoneAuto.touchEnabled || !phoneAuto.show) throw new Error(`Android auto mode was not detected: ${JSON.stringify(phoneAuto)}`)
  await phonePage.screenshot({ path: `${out}/07-phone-title.png` })
  await phonePage.tap('[data-screen="title"] [data-action="play"]')
  await phonePage.waitForSelector('[data-screen="hud"].is-active')
  await phonePage.waitForTimeout(500)
  for (const action of ['fire', 'climb', 'descend']) {
    if (!(await phonePage.locator(`[data-touch="${action}"]`).isVisible())) throw new Error(`Android ${action} control is hidden`)
  }
  const touchMove = await phonePage.evaluate(() => {
    const { game, input } = window.__game
    const start = game['player'].position
    input.setTouchMove(0, 1)
    for (let i = 0; i < 60; i += 1) {
      input.update(1 / 60)
      game.step(1 / 60)
    }
    input.setTouchMove(0, 0)
    return start.distanceTo(game['player'].position)
  })
  if (touchMove < 0.5) throw new Error(`Android virtual movement did not move the drone (${touchMove.toFixed(2)} m)`)
  await phonePage.screenshot({ path: `${out}/08-phone-hud.png` })
  await phone.close()

  if (errors.length) throw new Error(`console/page/network errors:\n  ${errors.join('\n  ')}`)
  await browser.close()
  cleanup()
  console.log(`smoke: OK — screenshots in ${out}/`)
} catch (err) {
  await fail(err?.message ?? String(err))
}
