// 最小复现:双击检测在"剖切他楼后再双击"场景下的行为追踪
import { spawn } from 'node:child_process'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9339
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, '--enable-unsafe-swiftshader',
   '--use-angle=swiftshader', '--no-first-run', '--user-data-dir=/tmp/ctx-debug-profile',
   '--window-size=800,600', 'about:blank'],
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
  if (r.result.exceptionDetails) console.error('EVAL ERR:', JSON.stringify(r.result.exceptionDetails).slice(0, 600))
  return r.result.result?.value
}
await send('Page.navigate', { url: 'http://localhost:7100/?q=low' })
await sleep(13000)
const out = await evaluate(`
  (async () => {
    const store = window.__campusStore
    const tap = window.__campusTap
    const ZONGHE = 'w561932273', WENKE = 'w563515413'
    const b = store.getState().buildings.find((x) => x.id === WENKE)
    store.getState().setSlicedBuilding(ZONGHE)
    await new Promise((r2) => setTimeout(r2, 400))
    const log = []
    tap(b); log.push(['tap1', performance.now() | 0, store.getState().slicedBuildingId])
    await new Promise((r2) => setTimeout(r2, 120))
    tap(b); log.push(['tap2', performance.now() | 0, store.getState().slicedBuildingId])
    return log
  })()
`)
console.log(JSON.stringify(out))
chrome.kill('SIGKILL')
process.exit(0)
