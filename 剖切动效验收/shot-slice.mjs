// 剖切动效截图 + 双击交互断言(CDP headless Chrome,swiftshader)
// 用法:node shot-slice.mjs —— 需 dev server 已起在 7100
// 产出:01-错峰展开中段.png 02-展开完成态.png 03-双击剖切状态.png + 交互断言日志
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9338
const BASE = 'http://localhost:7100'
const ZONGHE = 'w561932273' // 综合大楼(12 层 hero)
const WENKE = 'w563515413' // 文科实验楼(5 层灰盒)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/ctx-slice-shot-profile',
    '--window-size=1280,800',
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
    } catch { /* retry */ }
    await sleep(250)
  }
  throw new Error('chrome devtools 未就绪')
}

const target = await getTarget()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
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

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) console.error('EVAL ERR:', JSON.stringify(r.result.exceptionDetails).slice(0, 400))
  return r.result.result?.value
}
const snap = async (file) => {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT_DIR, file), Buffer.from(res.result.data, 'base64'))
  console.log('saved:', file)
}

await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
})
await send('Page.navigate', { url: `${BASE}/?q=low&t=10:30` })
await sleep(14000)

// ① 错峰展开中段:剖切综合大楼 + 相机聚焦,~1s 时截图(12 层错峰应正展开到一半)
await evaluate(`
  const s = window.__campusStore.getState();
  s.selectBuilding('${ZONGHE}');
  s.focusCamera({ type: 'building', id: '${ZONGHE}' });
  s.setSlicedBuilding('${ZONGHE}');
  'go'
`)
await sleep(1000)
await snap('01-错峰展开中段.png')

// ② 展开完成态
await sleep(4000)
await snap('02-展开完成态.png')

// ③ 双击交互断言 + 截图
const r = await evaluate(`
  (async () => {
    const out = {}
    const store = window.__campusStore
    const tap = window.__campusTap
    const b = store.getState().buildings.find((x) => x.id === '${WENKE}')
    // A. 双击文科实验楼(120ms 内两击)→ 应切换到该楼剖切
    tap(b); const t1 = performance.now()
    await new Promise((r2) => setTimeout(r2, 120))
    tap(b); const t2 = performance.now()
    out.doubleTapOpen = store.getState().slicedBuildingId === '${WENKE}'
    out.gapA = Math.round(t2 - t1)
    // B. 双击已剖切的同楼 → 应收起
    await new Promise((r2) => setTimeout(r2, 1200))
    tap(b)
    await new Promise((r2) => setTimeout(r2, 120))
    tap(b)
    out.doubleTapClose = store.getState().slicedBuildingId === null
    // C. 剖切综合大楼后单击文科实验楼 → 应退出剖切
    store.getState().setSlicedBuilding('${ZONGHE}')
    await new Promise((r2) => setTimeout(r2, 600))
    tap(b)
    out.singleTapClears = store.getState().slicedBuildingId === null
    // D. 恢复:双击文科实验楼进入剖切,供截图
    await new Promise((r2) => setTimeout(r2, 600))
    tap(b)
    await new Promise((r2) => setTimeout(r2, 120))
    tap(b)
    out.finalSliced = store.getState().slicedBuildingId
    return out
  })()
`)
console.log('交互断言:', JSON.stringify(r))
await sleep(3000) // 等相机飞行 + 错峰展开落定
await snap('03-双击剖切状态.png')

chrome.kill('SIGKILL')
console.log('done')
process.exit(0)
