import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ChevronRight, CircleDot, Flag, Navigation, Route } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import { requestRooms } from '../../lib/roomsLoader'
import { LocateButton } from './LocateButton'

/**
 * 导航面板:起终点输入(实名楼宇候选)+ 路径步骤展示。
 * 路径计算由 导航Agent 负责,本面板通过 submitCommand 发起指令并展示 Agent 返回的步骤文本。
 * M4:目的地若是具体房间(rooms 数据可查到),导航结果提供「定位到房间」点对点运镜入口。
 */
export function NavigationPanel() {
  const buildings = useCampusStore((s) => s.buildings)
  const rooms = useCampusStore((s) => s.rooms)
  const messages = useCampusStore((s) => s.messages)
  const sceneMode = useCampusStore((s) => s.sceneMode)
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const selectRoom = useCampusStore((s) => s.selectRoom)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)
  const locatingRoomId = useCampusStore((s) => s.locatingRoomId)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [pending, setPending] = useState(false)

  // 导航面板首次打开 = rooms 懒加载触发点(幂等;房间级目的地候选在数据到达后可用)
  useEffect(() => {
    void requestRooms()
  }, [])

  const placeNames = useMemo(
    () => buildings.filter((b) => b.name).map((b) => b.name as string).sort((a, b) => a.localeCompare(b, 'zh')),
    [buildings],
  )

  // 目的地房间匹配:精确同名优先,其次唯一/首个包含匹配(如「C302」「国际会议中心101」)
  const destRoom = useMemo(() => {
    const q = end.trim()
    if (q.length < 2) return null
    const exact = rooms.filter((r) => r.name === q)
    if (exact.length > 0) return exact[0]
    const partial = rooms.filter((r) => r.name.includes(q))
    return partial.length > 0 ? partial[0] : null
  }, [rooms, end])

  const destBuildingName = destRoom
    ? (buildings.find((b) => b.id === destRoom.buildingId)?.name ?? destRoom.buildingId)
    : null

  // 房间级目的地定位:选中 + 剖切所在楼 + 三段式运镜
  const locateDestRoom = () => {
    if (!destRoom) return
    selectRoom(destRoom.id)
    setSlicedBuilding(destRoom.buildingId)
    focusCamera({ type: 'room', id: destRoom.id })
  }

  // 最新一条 Agent 导航回复 → 拆分为步骤
  const steps = useMemo(() => {
    if (sceneMode !== 'navigation') return []
    const last = [...messages].reverse().find((m) => m.role === 'agent')
    if (!last) return []
    return last.text
      .split(/\n|→|⇒/)
      .map((s) => s.trim().replace(/^\d+[.、)]\s*/, ''))
      .filter(Boolean)
  }, [messages, sceneMode])

  const go = async () => {
    if (!start.trim() || !end.trim()) return
    setPending(true)
    try {
      await submitCommand(`从${start.trim()}到${end.trim()}怎么走`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div style={S.root}>
      <div style={S.form}>
        <label style={S.label}>
          <CircleDot size={13} color="#3fd08c" />
          <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="起点,如:南大门"
            list="ctwin-places" style={S.input} />
        </label>
        <label style={S.label}>
          <Flag size={13} color="#ff3b30" />
          <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="终点,如:文体中心"
            list="ctwin-places" style={S.input} />
        </label>
        <datalist id="ctwin-places">
          {placeNames.map((n) => <option key={n} value={n} />)}
          {rooms.map((r) => <option key={r.id} value={r.name} />)}
        </datalist>
        <button type="button" onClick={() => void go()} disabled={pending || !start.trim() || !end.trim()}
          style={{ ...S.primaryBtn, opacity: !pending && start.trim() && end.trim() ? 1 : 0.4 }}>
          <Navigation size={14} /> {pending ? '规划中…' : '规划路线'}
        </button>
      </div>

      <div style={S.sectionTitle}>路径指引</div>
      {steps.length === 0 ? (
        <div style={S.empty}>
          暂无路径。输入起终点后由 导航Agent 规划,3D 场景同步展示流光路径。
        </div>
      ) : (
        <>
          <div style={S.steps}>
            {steps.map((s, i) => (
              <div key={`${i}_${s}`} style={S.step}>
                <span style={S.stepNo}>{i + 1}</span>
                <span style={S.stepText}>{s}</span>
                {i < steps.length - 1 && <ChevronRight size={12} style={S.stepArrow} />}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => focusCamera({ type: 'route' })} style={S.ghostBtn}>
            <Route size={13} /> 镜头查看路径
          </button>
        </>
      )}

      {/* M4:目的地命中具体房间(rooms 可查)→ 提供点对点「定位到房间」入口;
          房间级目的地 Agent 可能只识别到楼宇或无法识别,故该入口独立于路径结果常驻 */}
      {destRoom && (
        <div style={S.destRoomRow}>
          <span style={S.destRoomHint}>
            目的地房间:{destBuildingName} · {destRoom.name}({destRoom.floor}F)
          </span>
          <LocateButton
            locating={locatingRoomId === destRoom.id}
            onClick={locateDestRoom}
            label={`定位到房间 ${destRoom.name}`}
          />
        </div>
      )}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: {
    display: 'flex', alignItems: 'center', gap: 8, background: '#0e1114',
    border: '1px solid #2a323b', borderRadius: 6, padding: '0 10px',
  },
  input: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    color: '#dde3e8', padding: '9px 0', fontSize: 13,
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: '#3aa7ff', color: '#0e1114', border: 'none', borderRadius: 6,
    padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  ghostBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: 'none', color: '#3aa7ff', border: '1px solid #3aa7ff55', borderRadius: 6,
    padding: '8px 12px', fontSize: 12.5, cursor: 'pointer',
  },
  sectionTitle: { fontSize: 12, opacity: 0.55, letterSpacing: 1, marginTop: 4 },
  empty: { fontSize: 12.5, opacity: 0.6, lineHeight: 1.8, padding: '8px 2px' },
  steps: { display: 'flex', flexDirection: 'column', gap: 6 },
  step: {
    display: 'flex', alignItems: 'center', gap: 8, background: '#161b21',
    border: '1px solid #2a323b', borderRadius: 8, padding: '8px 10px',
  },
  stepNo: {
    width: 20, height: 20, borderRadius: 10, background: '#3aa7ff22', color: '#3aa7ff',
    fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  stepText: { fontSize: 12.5, lineHeight: 1.5, flex: 1 },
  stepArrow: { opacity: 0.35, flexShrink: 0 },
  destRoomRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    background: '#161b21', border: '1px solid #2a323b', borderRadius: 8, padding: '8px 10px',
  },
  destRoomHint: { fontSize: 12, opacity: 0.75, lineHeight: 1.5, flex: 1 },
}
