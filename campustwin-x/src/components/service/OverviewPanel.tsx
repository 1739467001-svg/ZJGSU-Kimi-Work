import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Building2, Ticket, Users, Zap } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import { useSimStore } from '../../store/simStore'
import { OccupancyChart } from '../charts/OccupancyChart'
import type { OccupancyDatum } from '../charts/OccupancyChart'
import { EnergyTrendChart } from '../charts/EnergyTrendChart'
import type { EnergyTrendPoint } from '../charts/EnergyTrendChart'
import { TrafficChart } from '../charts/TrafficChart'
import type { TrafficDatum } from '../charts/TrafficChart'

const HISTORY_CAP = 60

/** 态势面板:KPI 卡 + 占用率 Top10 + 能耗趋势 + 人流分布 + 异常列表(点击定位) */
export function OverviewPanel() {
  const buildings = useCampusStore((s) => s.buildings)
  const rooms = useCampusStore((s) => s.rooms)
  const tickets = useCampusStore((s) => s.tickets)
  const focusCamera = useCampusStore((s) => s.focusCamera)

  const buildingOccupancy = useSimStore((s) => s.buildingOccupancy)
  const buildingEnergy = useSimStore((s) => s.buildingEnergy)
  const pathCrowd = useSimStore((s) => s.pathCrowd)
  const nowMs = useSimStore((s) => s.simClock.nowMs)

  const buildingName = useMemo(() => {
    const m = new Map(buildings.map((b) => [b.id, b.name ?? b.id]))
    return (id: string) => m.get(id) ?? id
  }, [buildings])

  // KPI 汇总
  const occValues = Object.values(buildingOccupancy)
  const avgOccupancy = occValues.length ? occValues.reduce((a, b) => a + b, 0) / occValues.length : null
  const totalEnergy = Object.values(buildingEnergy).reduce((a, b) => a + b, 0)
  const crowdValues = Object.values(pathCrowd)
  const avgCrowd = crowdValues.length ? crowdValues.reduce((a, b) => a + b, 0) / crowdValues.length : null
  const openTickets = tickets.filter((t) => t.status !== 'done')

  // 能耗趋势:simEngine 快照本地累积(只读契约,历史由面板侧维护)
  const [history, setHistory] = useState<EnergyTrendPoint[]>([])
  const lastRef = useRef(0)
  useEffect(() => {
    const kwh = Object.values(buildingEnergy).reduce((a, b) => a + b, 0)
    if (kwh <= 0) return
    if (nowMs - lastRef.current < 5000) return
    lastRef.current = nowMs
    setHistory((h) => [...h.slice(-(HISTORY_CAP - 1)), { t: nowMs, kwh }])
  }, [buildingEnergy, nowMs])

  const topOccupancy: OccupancyDatum[] = useMemo(
    () => Object.entries(buildingOccupancy)
      .map(([id, v]) => ({ buildingId: id, name: buildingName(id), value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
    [buildingOccupancy, buildingName],
  )

  const topTraffic: TrafficDatum[] = useMemo(
    () => Object.entries(pathCrowd)
      .map(([id, v]) => ({ name: id, value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    [pathCrowd],
  )

  // 异常:未办结工单 + 高占用(≥90%)楼宇
  const crowded = useMemo(
    () => Object.entries(buildingOccupancy).filter(([, v]) => v >= 0.9).map(([id, v]) => ({ id, v })),
    [buildingOccupancy],
  )

  return (
    <div style={S.root}>
      <div style={S.kpiGrid}>
        <Kpi icon={<Users size={15} color="#3aa7ff" />} label="全校占用率"
          value={avgOccupancy != null ? `${Math.round(avgOccupancy * 100)}%` : '—'} />
        <Kpi icon={<Zap size={15} color="#e8b84b" />} label="今日能耗"
          value={totalEnergy > 0 ? `${totalEnergy.toFixed(0)}` : '—'} unit="kWh" />
        <Kpi icon={<Building2 size={15} color="#3fd08c" />} label="当前人流密度"
          value={avgCrowd != null ? `${Math.round(avgCrowd * 100)}%` : '—'} />
        <Kpi icon={<Ticket size={15} color="#ff3b30" />} label="异常工单"
          value={String(openTickets.length)} unit="件" alert={openTickets.length > 0} />
      </div>

      <div style={S.sectionTitle}>楼宇占用率 Top10(点击定位)</div>
      {topOccupancy.length ? (
        <OccupancyChart data={topOccupancy} onSelect={(id) => focusCamera({ type: 'building', id })} />
      ) : (
        <div style={S.empty}>等待仿真引擎快照…</div>
      )}

      <div style={S.sectionTitle}>今日能耗趋势</div>
      {history.length > 1 ? <EnergyTrendChart points={history} /> : <div style={S.empty}>能耗快照累积中…</div>}

      <div style={S.sectionTitle}>人流密度分布</div>
      {topTraffic.length ? <TrafficChart data={topTraffic} /> : <div style={S.empty}>等待人流仿真快照…</div>}

      <div style={S.sectionTitle}>异常与预警 · {openTickets.length + crowded.length}</div>
      {openTickets.length === 0 && crowded.length === 0 ? (
        <div style={S.empty}>全域运行正常。</div>
      ) : (
        <div style={S.list}>
          {crowded.map(({ id, v }) => (
            <button key={`c_${id}`} type="button" style={S.alarm} onClick={() => focusCamera({ type: 'building', id })}>
              <AlertTriangle size={13} color="#e8843b" />
              <span style={S.alarmText}>{buildingName(id)} 占用率 {Math.round(v * 100)}%,建议引导分流</span>
              <ArrowRight size={12} style={{ opacity: 0.5 }} />
            </button>
          ))}
          {openTickets.map((t) => {
            const room = rooms.find((r) => r.id === t.roomId)
            const bid = room?.buildingId
            return (
              <button key={t.id} type="button" style={S.alarm}
                onClick={() => (bid ? focusCamera({ type: 'building', id: bid }) : focusCamera({ type: 'room', id: t.roomId }))}>
                <AlertTriangle size={13} color="#ff3b30" />
                <span style={S.alarmText}>{room?.name ?? t.roomId}:{t.desc}({t.status === 'new' ? '待受理' : '处理中'})</span>
                <ArrowRight size={12} style={{ opacity: 0.5 }} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Kpi(props: { icon: ReactNode; label: string; value: string; unit?: string; alert?: boolean }) {
  return (
    <div style={{ ...S.kpi, borderColor: props.alert ? '#ff3b3066' : '#2a323b' }}>
      <div style={S.kpiHead}>{props.icon}<span style={S.kpiLabel}>{props.label}</span></div>
      <div style={{ ...S.kpiValue, color: props.alert ? '#ff3b30' : '#dde3e8' }}>
        {props.value}
        {props.unit && <span style={S.kpiUnit}> {props.unit}</span>}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  kpiGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  kpi: { background: '#161b21', border: '1px solid #2a323b', borderRadius: 8, padding: '10px 12px' },
  kpiHead: { display: 'flex', alignItems: 'center', gap: 6 },
  kpiLabel: { fontSize: 11, opacity: 0.6 },
  kpiValue: { fontSize: 22, fontWeight: 700, marginTop: 4, fontVariantNumeric: 'tabular-nums' },
  kpiUnit: { fontSize: 11, fontWeight: 400, opacity: 0.5 },
  sectionTitle: { fontSize: 12, opacity: 0.55, letterSpacing: 1, marginTop: 4 },
  empty: { fontSize: 12.5, opacity: 0.6, padding: '8px 2px' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  alarm: {
    display: 'flex', alignItems: 'center', gap: 8, background: '#161b21',
    border: '1px solid #2a323b', borderRadius: 8, padding: '8px 10px',
    color: '#dde3e8', cursor: 'pointer', textAlign: 'left',
  },
  alarmText: { fontSize: 12.5, flex: 1, lineHeight: 1.5 },
}
