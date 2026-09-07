// 移动端信息卡验收截图脚本(CDP 驱动 headless Chrome,swiftshader 软渲 WebGL)
// 用法:node cdp-shot.mjs —— 需 dev server 已起在 7100
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = dirname(fileURLToPath(import.meta.url))
mkdirSync(OUT_DIR, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const BASE = 'http://localhost:7100'
const BUILDING_ID = 'w561932273' // 综合大楼(12 层,有多间可预约会议室)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=/tmp/ctx-shot-profile',
    '--window-size=390,844',
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

/**
 * @param {string} url 页面地址
 * @param {string} file 输出文件名
 * @param {{evaluate?: string, waitMs?: number, afterMs?: number, mobile?: boolean}} opts
 */
async function shot(url, file, { evaluate, waitMs = 12000, afterMs = 3000, mobile = true } = {}) {
  // headless Chrome 窗口最小宽 500,用设备仿真拿到真实 390x844 手机视口
  await send(
    'Emulation.setDeviceMetricsOverride',
    mobile
      ? { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }
      : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  )
  await send('Page.navigate', { url })
  await sleep(waitMs) // 等数据加载 + swiftshader 软渲出楼体
  if (evaluate) {
    await send('Runtime.evaluate', { expression: evaluate })
    await sleep(afterMs) // 等选中运镜/卡片动画落定
  }
  const res = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT_DIR, file), Buffer.from(res.result.data, 'base64'))
  console.log('saved:', file)
}

// 1. 移动端默认页(未选中)
await shot(`${BASE}/?q=low`, '01-移动端默认页.png')

// 2. 移动端选中楼宇:默认应为 48px 收起细栏
await shot(`${BASE}/?q=low`, '02-移动端楼宇卡-收起细栏.png', {
  evaluate: `window.__campusStore.getState().selectBuilding('${BUILDING_ID}')`,
})

// 3. 收起态点击细栏 → 展开详情(限高 24%)
await shot(`${BASE}/?q=low`, '03-移动端楼宇卡-展开.png', {
  evaluate: `
    window.__campusStore.getState().selectBuilding('${BUILDING_ID}');
    setTimeout(() => document.querySelector('[aria-label="展开楼宇详情"]')?.click(), 1500);
  `,
  afterMs: 4000,
})

// 4. 房间深链:房间卡默认收起细栏(导航按钮应可见)
await shot(`${BASE}/?q=low&room=r_zh_901`, '04-移动端房间卡-收起细栏.png', { waitMs: 15000 })

// 5. 桌面端对照:选中楼宇应仍为右下角完整卡片(验证本次改动不影响桌面端)
await shot(
  `${BASE}/?q=low`,
  '05-桌面端楼宇卡-无变化对照.png',
  {
    mobile: false,
    evaluate: `window.__campusStore.getState().selectBuilding('${BUILDING_ID}')`,
  },
)

chrome.kill('SIGKILL')
console.log('done')
process.exit(0)
