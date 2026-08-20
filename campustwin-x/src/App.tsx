// 商大元境 CampusTwin X —— 应用壳:
// 沉浸模式(全屏 3D + 品牌条 + 指令胶囊) / 工作台模式(指挥台 | 3D | 服务台)
// 启动时:装载数据 → 注入 Agent 指令处理器 → 拉起仿真引擎。
import { lazy, Suspense, useEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import CampusCanvas from './components/campus3d/CampusCanvas'
import CommandPanel from './components/layout/CommandPanel'
import QualitySwitch from './components/ui/QualitySwitch'
import TimeSwitch from './components/ui/TimeSwitch'
import { loadCampusData, type BakedBuilding, type CampusData } from './lib/campusData'
import { loadRooms } from './lib/rooms'
import { useCampusStore } from './store/campusStore'
import { useUIStore } from './store/uiStore'
import { useSimStore } from './store/simStore'
import { createCommandHandler } from './agent'
import { startSimEngine } from './sim/simEngine'

// 服务台(预约/报修/态势/导航/导游,内含 echarts)非首屏必需,
// 懒加载为独立 chunk,切入工作台/打开面板时再拉取
const ServiceDesk = lazy(() =>
  import('./components/layout/ServiceDesk').then((m) => ({ default: m.ServiceDesk })),
)

const ZONE_NAME: Record<string, string> = {
  teaching: '教学区', north_teaching: '中北部教学区', ne_teaching: '东北教学区', center: '中心区',
  south_colleges: '南部学院楼群', sw_colleges: '西南学院楼群', nw_group: '西北组团',
  west_sports: '西侧运动区', east_park: '东部公园',
  life_qianjiangwan: '钱江湾生活区', life_jinshagang: '金沙港生活区', life_yupingzhou: '玉屏洲生活区',
  outside: '校外',
}
const FEATURE_NAME: Record<string, string> = {
  teaching: '教学楼', college: '学院楼', library: '图书馆', admin: '行政', venue: '场馆',
  sport: '体育', dorm: '公寓', canteen: '食堂', service: '配套', unknown: '其他',
}

/** 模式切换(沉浸 / 工作台),悬浮于 3D 视口顶中 */
function ModeToggle() {
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)
  return (
    <div style={S.modeToggle}>
      {(['immersive', 'workbench'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          style={m === mode ? { ...S.modeBtn, ...S.modeBtnActive } : S.modeBtn}
        >
          {m === 'immersive' ? '沉浸模式' : '工作台'}
        </button>
      ))}
    </div>
  )
}

/** 沉浸模式指令胶囊:首次下达指令后自动切入工作台 */
function CommandCapsule() {
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const setMode = useUIStore((s) => s.setMode)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)

  const submit = () => {
    const t = text.trim()
    if (!t || pending) return
    setPending(true)
    setText('')
    void submitCommand(t).finally(() => setPending(false))
    setMode('workbench')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <div style={S.capsule}>
      <input
        style={S.capsuleInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="一句话指挥校园:帮我找一个 10 人会议室 / 图书馆还有座吗 / 带我逛校园…"
        aria-label="指挥指令输入"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!text.trim() || pending}
        style={{ ...S.capsuleBtn, ...(!text.trim() || pending ? S.capsuleBtnDisabled : null) }}
        title="发送指令"
      >
        <SendHorizontal size={15} />
      </button>
    </div>
  )
}

/** 选中楼宇信息卡(两种模式共用,浮于 3D 视口右下) */
function SelectedCard({ building }: { building: BakedBuilding }) {
  const sliced = useCampusStore((s) => s.slicedBuildingId === building.id)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)
  return (
    <div style={S.card}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{building.name ?? '未命名楼宇'}</div>
      {building.alias.length > 0 && <div style={S.row}>别名:{building.alias.join('、')}</div>}
      <div style={S.row}>分区:{ZONE_NAME[building.zone] ?? building.zone}</div>
      <div style={S.row}>
        功能:{FEATURE_NAME[building.feature] ?? building.feature} · LOD{building.lod}
        {building.hero ? ' · 地标精模' : ''}
      </div>
      <div style={S.row}>层数:{building.levels} · 高度:{building.height}m</div>
      {sliced && (
        <div style={S.row}>
          分层视图:逐层展开,显示各层房间位置(点击空白处亦可退出)
          <button type="button" onClick={() => setSlicedBuilding(null)} style={S.cardBtn}>
            退出分层
          </button>
        </div>
      )}
    </div>
  )
}

/** 全屏启动 loading:深色底 + 品牌文字呼吸动画,避免白屏(样式见 index.css) */
function BootLoading() {
  return (
    <div className="ctx-boot-loading" role="status" aria-label="平台加载中">
      <div className="ctx-boot-loading-title">商大元境 · CampusTwin X</div>
      <div className="ctx-boot-loading-sub">浙江工商大学下沙校区 · 数据加载中…</div>
    </div>
  )
}

export default function App() {
  const [data, setData] = useState<CampusData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mode = useUIStore((s) => s.mode)
  const selectedBuildingId = useCampusStore((s) => s.selectedBuildingId)

  // 启动序列:数据 → store → Agent 处理器 → 仿真引擎(卸载时停止)
  useEffect(() => {
    let cancelled = false
    let stopSim: (() => void) | undefined
    loadCampusData()
      .then(async (d) => {
        if (cancelled) return
        setData(d)
        useCampusStore.getState().setBuildings(d.buildings)
        const rooms = await loadRooms()
        if (cancelled) return
        useCampusStore.getState().setRooms(rooms)
        useCampusStore.getState().registerCommandHandler(
          createCommandHandler({
            buildings: d.buildings,
            stores: { campus: useCampusStore, ui: useUIStore, sim: useSimStore },
          }),
        )
        stopSim = startSimEngine()

        // dev 调试句柄:e2e/无头截图验证用(仅开发服务器,构建产物不含)
        if (import.meta.env.DEV) {
          ;(window as unknown as Record<string, unknown>).__campusStore = useCampusStore
        }

        // 演示/调试:URL 锁定仿真时刻,如 ?t=21:30(当日,locked 不流逝)
        const params = new URLSearchParams(window.location.search)
        const tm = /^(\d{1,2}):(\d{2})$/.exec(params.get('t') ?? '')
        if (tm) {
          const d = new Date()
          d.setHours(Number(tm[1]), Number(tm[2]), 0, 0)
          useSimStore.getState().setSimClock({ nowMs: d.getTime(), locked: true })
        }
        // 画质档 URL 固定:?q=low|medium|high(同时关闭自动降级)
        const qp = params.get('q')
        if (qp === 'low' || qp === 'medium' || qp === 'high') {
          useUIStore.getState().setQuality(qp)
          useUIStore.getState().setAutoQuality(false)
        }
        // 界面模式深链:?mode=immersive|workbench
        const mp = params.get('mode')
        if (mp === 'immersive' || mp === 'workbench') useUIStore.getState().setMode(mp)
      })
      .catch((e) => setError(String(e)))
    return () => {
      cancelled = true
      stopSim?.()
    }
  }, [])

  if (error) return <div style={S.center}>数据加载失败:{error}</div>
  if (!data) return <BootLoading />

  const namedCount = data.buildings.filter((b) => b.name).length
  const selected = selectedBuildingId
    ? (data.buildings.find((b) => b.id === selectedBuildingId) ?? null)
    : null

  const viewport = (
    <div style={S.canvasWrap}>
      <CampusCanvas data={data} />
      <QualitySwitch />
      <TimeSwitch />
      <ModeToggle />
      {selected && <SelectedCard building={selected} />}
      <div style={S.hint}>拖拽旋转 · 滚轮缩放 · 点击楼宇聚焦</div>
    </div>
  )

  return (
    <div style={S.root}>
      {mode === 'immersive' ? (
        <>
          {viewport}
          <div style={S.topbar}>
            <span style={{ fontWeight: 700, letterSpacing: 1 }}>商大元境 · CampusTwin X</span>
            <span style={{ opacity: 0.6 }}>
              浙江工商大学下沙校区 · 数据 © OpenStreetMap contributors
            </span>
          </div>
          <div style={S.stat}>
            楼宇 {data.buildings.length}(实名 {namedCount}) · 道路 {data.roads.length} · 水系{' '}
            {data.water.length} · 树木 {data.trees.length} · 地标 {data.landmarks.length}
          </div>
          <CommandCapsule />
        </>
      ) : (
        <div style={S.workbench}>
          <CommandPanel />
          {viewport}
          {/* 懒加载服务台:chunk 就绪前右侧留空,不阻塞 3D 首屏 */}
          <Suspense fallback={null}>
            <ServiceDesk />
          </Suspense>
        </div>
      )}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: {
    position: 'fixed', inset: 0, overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif', color: '#dde3e8',
    background: '#0e1114',
  },
  center: {
    position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
    background: '#0e1114', color: '#dde3e8', fontFamily: 'system-ui',
  },
  canvasWrap: { position: 'relative', flex: 1, minWidth: 0, height: '100%' },
  workbench: { display: 'flex', height: '100%' },
  topbar: {
    position: 'absolute', top: 0, left: 0, right: 0, padding: '12px 20px',
    display: 'flex', gap: 16, alignItems: 'baseline',
    background: 'linear-gradient(#0e1114cc, transparent)', pointerEvents: 'none',
  },
  stat: {
    position: 'absolute', left: 16, bottom: 16, fontSize: 12, opacity: 0.7, pointerEvents: 'none',
  },
  hint: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 12,
    fontSize: 12, opacity: 0.45, pointerEvents: 'none',
  },
  card: {
    position: 'absolute', right: 16, bottom: 40, minWidth: 230,
    background: '#161b21ee', border: '1px solid #2a323b', borderRadius: 10,
    padding: '13px 15px', boxShadow: '0 8px 30px #00000088', zIndex: 15,
  },
  row: { fontSize: 12.5, marginTop: 6, opacity: 0.85 },
  cardBtn: {
    display: 'block', marginTop: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
    background: '#3aa7ff22', color: '#3aa7ff', border: '1px solid #3aa7ff55', borderRadius: 6,
  },
  modeToggle: {
    position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
    display: 'flex', gap: 2, padding: 3, zIndex: 20,
    background: '#161b21cc', border: '1px solid #2a323b', borderRadius: 8,
  },
  modeBtn: {
    border: 'none', background: 'transparent', color: '#dde3e8',
    fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', opacity: 0.65,
  },
  modeBtnActive: { background: '#3aa7ff22', color: '#3aa7ff', opacity: 1 },
  capsule: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 42,
    display: 'flex', alignItems: 'center', gap: 8, width: 'min(620px, 72vw)',
    padding: '8px 10px 8px 16px', borderRadius: 999,
    background: '#161b21ee', border: '1px solid #2a323b',
    boxShadow: '0 12px 40px #00000099', zIndex: 20,
  },
  capsuleInput: {
    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
    color: '#dde3e8', fontSize: 13.5,
  },
  capsuleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: '#3aa7ff', color: '#0e1114', flexShrink: 0,
  },
  capsuleBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
}
