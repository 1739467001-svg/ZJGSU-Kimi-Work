// rooms.json 懒加载 + 移动端降载验收脚本(CDP 驱动 headless Chrome,swiftshader 软渲 WebGL)
// 用法:node rooms-lazy-verify.mjs —— 需 dev server 已起在 7100
// 产出:
//   before.json —— 首屏(无触发)全部网络请求 URL 列表,断言不含 rooms.json
//   after.json  —— ?room=r_zh_901 深链触发剖切后的请求列表,断言含 rooms.json
//   06-移动端390x844-降载后.png / 07-桌面1440x900-对照.png
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9334
const BASE = 'http://localhost:7100'
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/ctx-lazy-profile',
    '--window-size=1440,900',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
process.on('exit', () => chrome.kill('SIGKILL'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const page = (await r.json()).find((t) => t.type === 'page')
      if (page) return page
    } catch {
      /* devtools 未就绪,重试 */
    }
    await sleep(250)
  }
  throw new Error('chrome devtools 未就绪')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
let requests = [] // Network.requestWillBeSent 收集
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Network.requestWillBeSent') {
    requests.push(msg.params.request.url)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++seq
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')

/** 导航 + 等待 + 收集网络请求,返回该次加载的 URL 列表 */
async function collect(url, waitMs) {
  requests = []
  await send('Page.navigate', { url })
  await sleep(waitMs)
  return [...new Set(requests)]
}

async function shot(file) {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT_DIR, file), Buffer.from(res.result.data, 'base64'))
  console.log('saved:', file)
}

// ---------- ① 首屏(桌面默认,无任何触发):不应请求 rooms.json ----------
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})
const before = await collect(`${BASE}/`, 14000)
writeFileSync(join(OUT_DIR, 'before.json'), JSON.stringify(before, null, 2))
const beforeHasRooms = before.some((u) => u.includes('rooms.json'))
console.log(`首屏请求 ${before.length} 个;含 rooms.json: ${beforeHasRooms}`)

// ---------- ② 深链 ?room=r_zh_901(剖切+选房)触发:应请求 rooms.json ----------
const after = await collect(`${BASE}/?room=r_zh_901`, 15000)
writeFileSync(join(OUT_DIR, 'after.json'), JSON.stringify(after, null, 2))
const afterHasRooms = after.some((u) => u.includes('rooms.json'))
console.log(`触发后请求 ${after.length} 个;含 rooms.json: ${afterHasRooms}`)

// ---------- ③ 移动端 390x844 截图(移动 UA,默认画质档应落 low) ----------
await send('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA })
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
})
await send('Page.navigate', { url: `${BASE}/` })
await sleep(14000)
await shot('06-移动端390x844-降载后.png')

// ---------- ④ 桌面 1440x900 对照截图(桌面 UA,默认档 medium 不变) ----------
await send('Emulation.setUserAgentOverride', { userAgent: '' })
await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
})
await send('Page.navigate', { url: `${BASE}/` })
await sleep(14000)
await shot('07-桌面1440x900-对照.png')

chrome.kill('SIGKILL')
console.log(
  beforeHasRooms ? 'FAIL: 首屏仍请求 rooms.json' : afterHasRooms ? 'PASS: 懒加载生效' : 'FAIL: 触发后仍未请求 rooms.json',
)
process.exit(beforeHasRooms || !afterHasRooms ? 1 : 0)
