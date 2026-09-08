// 补充验证:medium 档(桌面标签预算)剖切 D 教学楼(5 层 × 40 房间)完成态
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9340
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--enable-unsafe-swiftshader',
   '--use-angle=swiftshader', '--no-first-run', '--user-data-dir=/tmp/ctx-shot2-profile',
   '--window-size=1280,800', '--hide-scrollbars', 'about:blank'],
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
    } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error('no devtools')
}
const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (m, p = {}) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })) })
await new Promise((r) => (ws.onopen = r))
await send('Page.enable')
await send('Runtime.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) console.error('EVAL ERR:', JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result.result?.value
}
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: 'http://localhost:7100/?q=medium&t=10:30&room=r_d301' })
await sleep(26000) // 房间深链:rooms 懒加载 + 三段式定位运镜 + 剖切错峰展开 + 标签淡入
const check = await evaluate(`({
  sliced: window.__campusStore.getState().slicedBuildingId,
  room: window.__campusStore.getState().selectedRoomId,
  rooms: window.__campusStore.getState().rooms.length,
})`)
console.log('state:', JSON.stringify(check))
const res = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(join(OUT_DIR, '04-桌面medium档-D教学楼完成态.png'), Buffer.from(res.result.data, 'base64'))
console.log('saved: 04-桌面medium档-D教学楼完成态.png')
chrome.kill('SIGKILL')
process.exit(0)
