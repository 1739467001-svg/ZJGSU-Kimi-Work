// 剖切流畅度测量脚本(CDP 驱动 headless Chrome,swiftshader 软渲)
// 用法:node measure-slice.mjs <label>   —— 需 dev server 已起在 7100
// 输出:measure-<label>.json,含各场景 longtask(>50ms 主线程长任务)与 rAF 帧率
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })
const LABEL = process.argv[2] ?? 'run'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9337
const BASE = 'http://localhost:7100'

// 场景:文科实验楼(布局计算最重,173ms 全层)、综合大楼(12 层 hero,错峰动画最长)
const SCENARIOS = [
  { key: 'wenke', id: 'w563515413', name: '文科实验楼' },
  { key: 'zonghe', id: 'w561932273', name: '综合大楼' },
]

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/ctx-measure-profile',
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
await send('Profiler.enable')
await send('Profiler.setSamplingInterval', { interval: 200 }) // 200µs 采样,拆 JS 热点

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.result.exceptionDetails) console.error('EVAL ERR:', JSON.stringify(r.result.exceptionDetails).slice(0, 500))
  return r.result.result?.value
}

// 小视口(500x375,headless 最小宽度)+ q=low:压低 swiftshader 单帧光栅耗时,
// 让 longtask/帧间隔更接近"主线程 JS 卡顿"本身;帧间隔(max gap)即用户体感卡顿
await send('Emulation.setDeviceMetricsOverride', {
  width: 500, height: 375, deviceScaleFactor: 1, mobile: false,
})
await send('Page.navigate', { url: `${BASE}/?q=low` })
await sleep(14000) // 数据加载 + 首屏运镜落定

await evaluate(`
  window.__lt = [];
  window.__frames = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__lt.push({ start: e.startTime, dur: e.duration });
  }).observe({ entryTypes: ['longtask'] });
  const loop = (t) => { window.__frames.push(t); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  'hooks-ok'
`)

const result = { label: LABEL, scenarios: [] }

for (const sc of SCENARIOS) {
  for (const phase of ['cold', 'warm']) {
    // cold = rooms.json 未加载的真实首击;warm = 收起后再展开(布局/纹理全冷)
    await evaluate(`window.__lt.length = 0; window.__frames.length = 0; 'reset'`)
    const t0 = Date.now()
    await send('Profiler.start')
    await evaluate(`
      window.__mark = performance.now();
      window.__campusStore.getState().setSlicedBuilding('${sc.id}');
      'sliced'
    `)
    await sleep(3500)
    const prof = await send('Profiler.stop')
    // JS 热点聚合:按 functionName+url 汇总自耗时(hitCount × 采样间隔)
    const hot = new Map()
    if (prof.result?.profile) {
      const iv = 0.2 // ms/采样(200µs)
      for (const n of prof.result.profile.nodes) {
        if (!n.hitCount) continue
        const fn = n.callFrame.functionName || '(匿名)'
        const file = (n.callFrame.url || '').split('/').pop().slice(0, 40)
        const key = `${fn} @${file}`
        hot.set(key, (hot.get(key) ?? 0) + n.hitCount * iv)
      }
    }
    const topJs = [...hot.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([fn, ms]) => ({ fn, ms: +ms.toFixed(1) }))
    const data = await evaluate(`({
      mark: window.__mark,
      lt: window.__lt.filter((e) => e.start >= window.__mark - 20),
      frames: window.__frames.filter((t) => t >= window.__mark),
      rooms: window.__campusStore.getState().rooms.length,
      sliced: window.__campusStore.getState().slicedBuildingId,
    })`)
    const totalLong = data.lt.reduce((a, e) => a + e.dur, 0)
    const worst = data.lt.reduce((a, e) => Math.max(a, e.dur), 0)
    // 动画窗口(点击后 0~2s)帧率 + 帧间隔(用户体感卡顿 = 相邻 rAF 最大间隔)
    const win = data.frames.filter((t) => t <= data.mark + 2000)
    const fps = win.length > 1 ? ((win.length - 1) / ((win[win.length - 1] - win[0]) / 1000)) : 0
    let maxGap = 0
    for (let i = 1; i < win.length; i++) maxGap = Math.max(maxGap, win[i] - win[i - 1])
    result.scenarios.push({
      scenario: `${sc.key}-${phase}`,
      building: sc.name,
      longTaskCount: data.lt.length,
      longTaskTotalMs: +totalLong.toFixed(1),
      worstLongTaskMs: +worst.toFixed(1),
      fpsFirst2s: +fps.toFixed(1),
      maxFrameGapMs: +maxGap.toFixed(1),
      frameCount2s: win.length,
      wallMs: Date.now() - t0,
      rooms: data.rooms,
      topJs,
      longTasks: data.lt.map((e) => ({ start: +(e.start - data.mark).toFixed(0), dur: +e.dur.toFixed(1) })),
    })
    console.log(
      `${sc.key}-${phase}: longtask=${data.lt.length} 共${totalLong.toFixed(0)}ms 最重${worst.toFixed(0)}ms fps(2s)=${fps.toFixed(1)} 最大帧间隔=${maxGap.toFixed(0)}ms 帧数=${win.length}`,
    )
    // 收起,留 1.5s 让卸载/收起动画结束
    await evaluate(`window.__campusStore.getState().setSlicedBuilding(null); 'unsliced'`)
    await sleep(1500)
  }
}

writeFileSync(join(OUT_DIR, `measure-${LABEL}.json`), JSON.stringify(result, null, 2))
console.log('saved:', `measure-${LABEL}.json`)
chrome.kill('SIGKILL')
process.exit(0)
