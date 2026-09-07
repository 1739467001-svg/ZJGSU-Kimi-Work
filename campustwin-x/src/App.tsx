// 商大元境 CampusTwin X —— 应用壳:
// 沉浸模式(全屏 3D + 品牌条 + 指令胶囊) / 工作台模式(指挥台 | 3D | 服务台)
// 启动时:装载数据 → 注入 Agent 指令处理器 → 拉起仿真引擎。
// 响应式(见 components/ui/useMediaQuery.ts):
//   手机 ≤768px —— 工作台抽屉化(3D 全屏 + 指令台/服务台底部抽屉 + 浮动按钮);
//   平板 769–1024px —— 隐藏左栏,指挥台变左侧抽屉,服务台保留右栏;
//   桌面 >1024px —— 原三栏布局不变。
import { lazy, Suspense, useEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { LayoutDashboard, MessageSquare, SendHorizontal } from 'lucide-react'
import CampusCanvas from './components/campus3d/CampusCanvas'
import CommandPanel from './components/layout/CommandPanel'
import QualitySwitch from './components/ui/QualitySwitch'
import TimeSwitch from './components/ui/TimeSwitch'
import FloorSelector from './components/ui/FloorSelector'
import RoomInfoCard from './components/ui/RoomInfoCard'
import { useIsMobile, useIsTablet } from './components/ui/useMediaQuery'
import { useSidebarCollapsed } from './components/ui/useSidebarCollapsed'
import { loadCampusData, type BakedBuilding, type CampusData } from './lib/campusData'
import { getBuildingIntro } from './lib/buildingIntro'
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
  sport: '体育', dorm: '公寓', canteen: '食堂', service: '配套', landmark: '地标', unknown: '其他',
}

/** 剖切引导气泡"已看过"标记的 localStorage key(带项目前缀) */
const SLICE_HINT_KEY = 'ctx_slice_hint_seen'

/** 双门是 landmark 无 building 记录:点击后合成伪楼宇卡片(简介走 buildingIntro 的 gate_* 条目) */
const GATE_PSEUDO: Record<string, { height: number }> = {
  gate_south: { height: 12 }, // 飞翔门翼尖约 8–12m
  gate_north: { height: 5 }, // 凯旋门门高 5 米多
}
function gateAsBuilding(data: CampusData, id: string): BakedBuilding | null {
  const lm = data.landmarks.find((l) => l.id === id)
  if (!lm) return null
  return {
    id: lm.id, name: lm.name, alias: [], feature: 'landmark', lod: 0,
    levels: 1, height: GATE_PSEUDO[id]?.height ?? 10, hero: true,
    zone: 'teaching', footprint: [], center: lm.position,
  }
}

/** 模式切换(沉浸 / 工作台),悬浮于 3D 视口顶中;手机端避开品牌条下移 */
function ModeToggle() {
  const mode = useUIStore((s) => s.mode)
  const setMode = useUIStore((s) => s.setMode)
  const isMobile = useIsMobile()
  const wrap: CSSProperties = isMobile
    ? {
        ...S.modeToggle,
        top: mode === 'immersive' ? 'calc(44px + var(--sat, 0px))' : 'calc(10px + var(--sat, 0px))',
      }
    : S.modeToggle
  return (
    <div style={wrap}>
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
function CommandCapsule({ onSubmitted }: { onSubmitted?: () => void }) {
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const setMode = useUIStore((s) => s.setMode)
  const isMobile = useIsMobile()
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)

  const submit = () => {
    const t = text.trim()
    if (!t || pending) return
    setPending(true)
    setText('')
    void submitCommand(t).finally(() => setPending(false))
    setMode('workbench')
    onSubmitted?.()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  return (
    <div style={isMobile ? S.capsuleMobile : S.capsule}>
      <input
        style={S.capsuleInput}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          isMobile
            ? '一句话指挥校园:找会议室 / 报修 / 逛校园…'
            : '一句话指挥校园:帮我找一个 10 人会议室 / 图书馆还有座吗 / 带我逛校园…'
        }
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

/** 选中楼宇信息卡(两种模式共用,浮于 3D 视口右下;手机端贴底全宽) */
function SelectedCard({ building }: { building: BakedBuilding }) {
  const sliced = useCampusStore((s) => s.slicedBuildingId === building.id)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)
  const highlightRooms = useCampusStore((s) => s.highlightRooms)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const rooms = useCampusStore((s) => s.rooms)
  const isMobile = useIsMobile()
  /** 移动端细栏展开态(默认收起;换楼/取消选中时由 App 侧 key 重挂载复位) */
  const [expanded, setExpanded] = useState(false)
  /** 剖切入口一次性引导气泡(localStorage 记住"已看过") */
  const [showSliceHint, setShowSliceHint] = useState(false)

  // 首次选中多层建筑时弹出引导;已看过(localStorage)则不再出现
  useEffect(() => {
    if (building.levels <= 1) return
    let seen = true
    try {
      seen = !!localStorage.getItem(SLICE_HINT_KEY)
    } catch {
      seen = true // 隐私模式等读不到存储时按已看过处理,避免反复打扰
    }
    if (!seen) setShowSliceHint(true)
  }, [building.id, building.levels])

  // 气泡消失:点击任意处 或 5 秒超时,并写入"已看过"
  useEffect(() => {
    if (!showSliceHint) return
    let done = false
    const dismiss = () => {
      if (done) return
      done = true
      setShowSliceHint(false)
      try {
        localStorage.setItem(SLICE_HINT_KEY, '1')
      } catch {
        /* 存储不可用时静默忽略 */
      }
    }
    const timer = window.setTimeout(dismiss, 5000)
    window.addEventListener('pointerdown', dismiss)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', dismiss)
    }
  }, [showSliceHint])

  // 可预约房间口径与预约面板一致:meeting 且 free
  const bookable = rooms.filter(
    (r) => r.buildingId === building.id && r.type === 'meeting' && r.status === 'free',
  )

  /** 分层展开:剖切该楼 + 染蓝全部可预约房间 + 相机聚焦;已剖切则收起并清高亮 */
  const toggleSlice = () => {
    if (sliced) {
      setSlicedBuilding(null)
      highlightRooms([])
    } else {
      setSlicedBuilding(building.id)
      if (bookable.length > 0) highlightRooms(bookable.map((r) => r.id))
      focusCamera({ type: 'building', id: building.id })
    }
  }

  // 移动端:字号整体下调一级(标题 15 / 正文 12),桌面端保持原字号
  const titleStyle: CSSProperties = isMobile
    ? { fontSize: 15, fontWeight: 700 }
    : { fontSize: 17, fontWeight: 700 }
  const rowStyle = isMobile ? S.rowMobile : S.row
  const introStyle: CSSProperties = isMobile
    ? { ...S.intro, fontSize: 12, lineHeight: 1.55 }
    : S.intro

  // 移动端卡片样式:默认 48px 细栏(overflow 裁掉详情),展开后限高 24% 内部滚动;
  // max-height/padding 过渡跟随底部抽屉的 ease-out 惯例(见 S.sheet)
  const cardStyle: CSSProperties = isMobile
    ? {
        ...S.cardMobile,
        maxHeight: expanded ? '24%' : 48,
        padding: expanded ? '11px 13px' : '0 12px',
        overflowY: expanded ? 'auto' : 'hidden',
      }
    : S.card

  return (
    <div style={cardStyle}>
      {/* 移动端细栏(常显):左楼名 + 关键摘要 + 右端展开/收起提示,点按任意处切换 */}
      {isMobile && (
        <div
          style={{ ...S.cardBarRow, height: expanded ? 26 : 48 }}
          onClick={() => setExpanded((v) => !v)}
          role="button"
          aria-expanded={expanded}
          aria-label={expanded ? '收起楼宇详情' : '展开楼宇详情'}
        >
          <span style={S.cardBarName}>{building.name ?? '未命名楼宇'}</span>
          <span style={S.cardBarSummary}>
            {bookable.length > 0
              ? `可预约 ${bookable.length} 间`
              : `${building.levels} 层 · ${building.height}m`}
          </span>
          <span style={S.cardBarToggle}>{expanded ? '收起 ▼' : '展开 ▲'}</span>
        </div>
      )}
      {!isMobile && <div style={titleStyle}>{building.name ?? '未命名楼宇'}</div>}
      {building.alias.length > 0 && <div style={rowStyle}>别名:{building.alias.join('、')}</div>}
      <div style={rowStyle}>分区:{ZONE_NAME[building.zone] ?? building.zone}</div>
      <div style={rowStyle}>
        功能:{FEATURE_NAME[building.feature] ?? building.feature} · LOD{building.lod}
        {building.hero ? ' · 地标精模' : ''}
      </div>
      <div style={rowStyle}>层数:{building.levels} · 高度:{building.height}m</div>
      <div style={introStyle}>{getBuildingIntro(building)}</div>
      {bookable.length > 0 && (
        <div style={rowStyle}>
          可预约房间:
          <span style={{ color: '#3fd08c', fontWeight: 600 }}>{bookable.length} 间</span>
          (会议室 · 当前空闲)
        </div>
      )}
      {building.levels > 1 && showSliceHint && (
        <div style={S.sliceHint} role="note">
          这栋楼有 {building.levels} 层,点击下方按钮可逐层展开查看房间
        </div>
      )}
      {building.levels > 1 && (
        <button
          type="button"
          onClick={toggleSlice}
          style={sliced ? S.cardBtnSliceActive : S.cardBtnSlice}
          className={sliced ? undefined : 'ctx-slice-btn'}
        >
          {sliced ? '收起剖切' : `分层展开(${building.levels} 层)`}
        </button>
      )}
      {sliced && (
        <div style={{ ...rowStyle, opacity: 0.6 }}>
          分层视图:逐层展开,显示各层房间位置(点击空白处亦可退出)
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

type DrawerKind = 'none' | 'command' | 'service'

export default function App() {
  const [data, setData] = useState<CampusData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mode = useUIStore((s) => s.mode)
  const selectedBuildingId = useCampusStore((s) => s.selectedBuildingId)
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const activePanel = useCampusStore((s) => s.activePanel)
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  /** 手机:指令台/服务台底部抽屉;平板:仅指令台侧边抽屉;桌面:不用抽屉 */
  const [drawer, setDrawer] = useState<DrawerKind>('none')
  /** 桌面端左栏(指挥台)开合,localStorage 持久化(右栏状态由 ServiceDesk 自管) */
  const [leftCollapsed, setLeftCollapsed] = useSidebarCollapsed('left')

  // 移动端:Agent 指令打开业务面板(activePanel 变化)时,自动弹出服务台抽屉让用户看到结果
  useEffect(() => {
    if (isMobile && mode === 'workbench' && activePanel !== 'empty') setDrawer('service')
  }, [activePanel, isMobile, mode])

  // 跨断点(如旋转屏幕、拖窗口)时复位抽屉,避免状态残留
  useEffect(() => {
    setDrawer('none')
  }, [isMobile, isTablet])

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

        // 房间级定位深链:?room=r_c305(剖切所在楼 + 选中房间 + 三段式运镜)
        const roomId = params.get('room')
        if (roomId) {
          const room = rooms.find((r) => r.id === roomId || r.name === roomId)
          if (room) {
            // 直达深链:跳过开场运镜,避免相机所有权竞争吞掉定位飞行
            useUIStore.getState().setOpeningPlayed(true)
            const cs = useCampusStore.getState()
            cs.setSlicedBuilding(room.buildingId)
            cs.selectRoom(room.id)
            cs.focusCamera({ type: 'room', id: room.id })
          }
        }
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
    ? (data.buildings.find((b) => b.id === selectedBuildingId) ??
      (selectedBuildingId in GATE_PSEUDO ? gateAsBuilding(data, selectedBuildingId) : null))
    : null

  /** 沉浸胶囊提交后:手机/平板弹出指令台抽屉;桌面若左栏收起则自动展开,确保用户看到回复 */
  const handleCapsuleSubmitted = () => {
    if (isMobile || isTablet) setDrawer('command')
    else setLeftCollapsed(false)
  }

  const viewport = (
    <div style={S.canvasWrap}>
      <CampusCanvas data={data} />
      <QualitySwitch />
      <TimeSwitch />
      <ModeToggle />
      <FloorSelector />
      {/* 房间卡与楼宇卡互斥:有房间选中时优先房间卡;key 保证换楼/换房时重挂载,移动端展开态复位为细栏 */}
      {selectedRoomId ? (
        <RoomInfoCard key={selectedRoomId} />
      ) : (
        selected && <SelectedCard key={selected.id} building={selected} />
      )}
      {/* 手机端选中卡片时隐藏操作提示,避免贴底元素互相遮挡 */}
      {!(isMobile && (selectedRoomId || selected)) && (
        <div style={isMobile ? (mode === 'immersive' ? S.hintMobile : S.hintMobileWb) : S.hint}>
          {isMobile
            ? '单指旋转 · 双指缩放 · 点按楼宇聚焦 · 多层建筑可分层展开'
            : '拖拽旋转 · 滚轮缩放 · 点击楼宇聚焦 · 选中多层建筑可分层展开查看每层房间'}
        </div>
      )}
    </div>
  )

  /** 手机工作台:3D 全屏 + 底部双抽屉(指令台/服务台互斥)+ 角落浮动按钮 */
  const workbenchMobile = (
    <div style={S.workbench}>
      {viewport}
      <button
        type="button"
        style={{ ...S.fab, ...S.fabLeft }}
        onClick={() => setDrawer((d) => (d === 'command' ? 'none' : 'command'))}
        aria-expanded={drawer === 'command'}
      >
        <MessageSquare size={16} /> 指令台
      </button>
      <button
        type="button"
        style={{ ...S.fab, ...S.fabRight }}
        onClick={() => setDrawer((d) => (d === 'service' ? 'none' : 'service'))}
        aria-expanded={drawer === 'service'}
      >
        <LayoutDashboard size={16} /> 服务台
      </button>
      {drawer !== 'none' && (
        <div style={S.backdrop} onClick={() => setDrawer('none')} aria-hidden="true" />
      )}
      {/* 抽屉常驻挂载(transform 滑出),保留聊天记录/面板状态 */}
      <div
        style={{ ...S.sheet, transform: drawer === 'command' ? 'translateY(0)' : 'translateY(105%)' }}
        aria-hidden={drawer !== 'command'}
      >
        <button type="button" style={S.grabber} onClick={() => setDrawer('none')} title="收起指令台">
          <span style={S.grabberBar} />
        </button>
        <CommandPanel drawer />
      </div>
      <div
        style={{
          ...S.sheet,
          ...S.sheetTall,
          transform: drawer === 'service' ? 'translateY(0)' : 'translateY(105%)',
        }}
        aria-hidden={drawer !== 'service'}
      >
        <button type="button" style={S.grabber} onClick={() => setDrawer('none')} title="收起服务台">
          <span style={S.grabberBar} />
        </button>
        <Suspense fallback={null}>
          <ServiceDesk sheet onClose={() => setDrawer('none')} />
        </Suspense>
      </div>
    </div>
  )

  /** 平板工作台:3D + 右栏服务台(沿用桌面件);左栏指挥台变侧边抽屉 */
  const workbenchTablet = (
    <div style={S.workbench}>
      {viewport}
      <button
        type="button"
        style={{ ...S.fab, ...S.fabLeft }}
        onClick={() => setDrawer((d) => (d === 'command' ? 'none' : 'command'))}
        aria-expanded={drawer === 'command'}
      >
        <MessageSquare size={16} /> 指令台
      </button>
      {drawer === 'command' && (
        <div style={S.backdrop} onClick={() => setDrawer('none')} aria-hidden="true" />
      )}
      <div
        style={{
          ...S.sideSheet,
          transform: drawer === 'command' ? 'translateX(0)' : 'translateX(-105%)',
        }}
        aria-hidden={drawer !== 'command'}
      >
        <CommandPanel drawer />
      </div>
      {/* 懒加载服务台:chunk 就绪前右侧留空,不阻塞 3D 首屏 */}
      <Suspense fallback={null}>
        <ServiceDesk />
      </Suspense>
    </div>
  )

  return (
    <div style={S.root}>
      {mode === 'immersive' ? (
        <>
          {viewport}
          <div style={isMobile ? S.topbarMobile : S.topbar}>
            <span style={{ fontWeight: 700, letterSpacing: 1, fontSize: isMobile ? 13 : 15 }}>
              商大元境 · CampusTwin X
            </span>
            {/* 手机端隐藏副标题,避免与居中模式开关争抢横向空间 */}
            {!isMobile && (
              <span style={{ opacity: 0.6 }}>
                浙江工商大学下沙校区 · 数据 © OpenStreetMap contributors
              </span>
            )}
          </div>
          {/* 手机端隐藏资产统计行,减少底部遮挡 */}
          {!isMobile && (
            <div style={S.stat}>
              楼宇 {data.buildings.length}(实名 {namedCount}) · 道路 {data.roads.length} · 水系{' '}
              {data.water.length} · 树木 {data.trees.length} · 地标 {data.landmarks.length}
            </div>
          )}
          <CommandCapsule onSubmitted={handleCapsuleSubmitted} />
        </>
      ) : isMobile ? (
        workbenchMobile
      ) : isTablet ? (
        workbenchTablet
      ) : (
        <div style={S.workbench}>
          <CommandPanel
            collapsed={leftCollapsed}
            onToggleCollapse={() => setLeftCollapsed(!leftCollapsed)}
          />
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
  workbench: { position: 'relative', display: 'flex', height: '100%' },
  topbar: {
    position: 'absolute', top: 0, left: 0, right: 0, padding: '12px 20px',
    display: 'flex', gap: 16, alignItems: 'baseline',
    background: 'linear-gradient(#0e1114cc, transparent)', pointerEvents: 'none',
  },
  topbarMobile: {
    position: 'absolute', top: 0, left: 0, right: 0,
    padding: 'calc(10px + var(--sat, 0px)) 14px 10px',
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
  hintMobile: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    bottom: 'calc(82px + var(--sab, 0px))',
    fontSize: 11.5, opacity: 0.45, pointerEvents: 'none', whiteSpace: 'nowrap',
  },
  hintMobileWb: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    bottom: 'calc(66px + var(--sab, 0px))',
    fontSize: 11.5, opacity: 0.45, pointerEvents: 'none', whiteSpace: 'nowrap',
  },
  card: {
    position: 'absolute', right: 16, bottom: 40, minWidth: 230,
    background: '#161b21ee', border: '1px solid #2a323b', borderRadius: 10,
    padding: '13px 15px', boxShadow: '0 8px 30px #00000088', zIndex: 15,
  },
  // 移动端楼宇卡:不再贴死全宽(左右各 10px),背景调低透明度让背后楼体透出;
  // 高度/maxHeight/overflow 由 SelectedCard 按 收起细栏/展开详情 两态内联给定
  cardMobile: {
    position: 'absolute',
    left: 'calc(10px + var(--sal, 0px))', right: 'calc(10px + var(--sar, 0px))',
    bottom: 'calc(84px + var(--sab, 0px))',
    background: '#161b21d8', border: '1px solid #2a323b', borderRadius: 10,
    boxShadow: '0 8px 30px #00000088', zIndex: 15,
    transition: 'max-height 0.24s ease-out, padding 0.24s ease-out',
  },
  row: { fontSize: 12.5, marginTop: 6, opacity: 0.85 },
  rowMobile: { fontSize: 12, marginTop: 5, opacity: 0.85 },
  // 移动端细栏行:左楼名(可截断)+ 摘要 + 右端展开/收起提示
  cardBarRow: {
    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
  },
  cardBarName: {
    fontSize: 15, fontWeight: 700, minWidth: 0,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  cardBarSummary: { fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', flexShrink: 0 },
  cardBarToggle: {
    marginLeft: 'auto', fontSize: 11.5, opacity: 0.6, whiteSpace: 'nowrap', flexShrink: 0,
  },
  intro: {
    fontSize: 12.5, marginTop: 8, paddingTop: 8, opacity: 0.75, lineHeight: 1.6,
    borderTop: '1px solid #2a323b',
  },
  // 分层展开按钮:暖金强调色(与选中房间/脉冲光柱的 #e8b84b 同族),
  // 未剖切时叠加 ctx-slice-btn 呼吸动画(见 index.css)引导发现入口
  cardBtnSlice: {
    display: 'block', marginTop: 10, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
    width: '100%', textAlign: 'center', fontFamily: 'inherit',
    background: '#e8b84b1f', color: '#e8b84b', border: '1px solid #e8b84b66', borderRadius: 6,
  },
  cardBtnSliceActive: {
    display: 'block', marginTop: 10, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
    width: '100%', textAlign: 'center', fontFamily: 'inherit',
    background: '#e8b84b33', color: '#f2cd7a', border: '1px solid #e8b84b', borderRadius: 6,
  },
  // 剖切入口一次性引导气泡:贴按钮上方,暖金描边;宽度受卡片约束,移动端不外溢
  sliceHint: {
    marginTop: 10, padding: '8px 10px', fontSize: 12, lineHeight: 1.5,
    background: '#e8b84b14', border: '1px solid #e8b84b55', borderRadius: 8,
    color: '#e8b84b', maxWidth: 260,
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
  capsuleMobile: {
    position: 'absolute', left: '50%', transform: 'translateX(-50%)',
    bottom: 'calc(14px + var(--sab, 0px))',
    display: 'flex', alignItems: 'center', gap: 8,
    width: 'calc(100vw - 32px - var(--sal, 0px) - var(--sar, 0px))',
    padding: '8px 10px 8px 16px', borderRadius: 999,
    background: '#161b21ee', border: '1px solid #2a323b',
    boxShadow: '0 12px 40px #00000099', zIndex: 20,
  },
  capsuleInput: {
    flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
    color: '#dde3e8', fontSize: 16,
  },
  capsuleBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
    background: '#3aa7ff', color: '#0e1114', flexShrink: 0,
  },
  capsuleBtnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  // ===== 移动端/平板工作台抽屉 =====
  fab: {
    position: 'absolute', bottom: 'calc(12px + var(--sab, 0px))', zIndex: 24,
    display: 'flex', alignItems: 'center', gap: 6,
    height: 44, padding: '0 16px', borderRadius: 999,
    background: '#161b21ee', border: '1px solid #2a323b', color: '#dde3e8',
    fontSize: 13, fontFamily: 'inherit', cursor: 'pointer',
    boxShadow: '0 8px 24px #00000077',
  },
  fabLeft: { left: 'calc(12px + var(--sal, 0px))' },
  fabRight: { right: 'calc(12px + var(--sar, 0px))' },
  backdrop: {
    position: 'absolute', inset: 0, background: '#00000066', zIndex: 28,
  },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    background: '#14181d', borderTop: '1px solid #2a323b',
    borderRadius: '16px 16px 0 0', zIndex: 30,
    paddingBottom: 'var(--sab, 0px)',
    transition: 'transform 0.26s ease-out',
  },
  sheetTall: { height: '65%' },
  grabber: {
    flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center',
    padding: '8px 0 4px', border: 'none', background: 'transparent', cursor: 'pointer',
  },
  grabberBar: { width: 36, height: 4, borderRadius: 2, background: '#3a4450' },
  sideSheet: {
    position: 'absolute', top: 0, left: 0, bottom: 0, width: 320, zIndex: 30,
    display: 'flex', flexDirection: 'column',
    background: '#14181d', borderRight: '1px solid #2a323b',
    boxShadow: '12px 0 32px rgba(0,0,0,0.35)',
    transition: 'transform 0.26s ease-out',
  },
}
