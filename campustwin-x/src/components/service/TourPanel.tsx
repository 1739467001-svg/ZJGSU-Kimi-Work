import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Compass, Pause, Play, Square } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import { useTourStore } from '../../store/tourStore'

/**
 * 导游面板:字幕式导游(进度与讲稿来自 tourStore,镜头由 TourCruise 逐站巡航)。
 * 上一站/下一站/暂停-继续/结束直接调 tourStore action;结束同时恢复 sceneMode/panel。
 */
export function TourPanel() {
  const sceneMode = useCampusStore((s) => s.sceneMode)
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const setSceneMode = useCampusStore((s) => s.setSceneMode)
  const setActivePanel = useCampusStore((s) => s.setActivePanel)
  const focusCamera = useCampusStore((s) => s.focusCamera)

  const waypoints = useTourStore((s) => s.waypoints)
  const currentIndex = useTourStore((s) => s.currentIndex)
  const status = useTourStore((s) => s.status)

  const touring = sceneMode === 'tour'
  const total = waypoints.length
  const wp = waypoints[currentIndex]
  /** 巡礼自然走完(镜头已返校):面板保留显示结束态,等用户点「结束」收尾 */
  const finished = touring && status === 'idle' && total > 0
  // 历史字幕:当前站之前最近 3 站的讲稿
  const history = waypoints
    .slice(Math.max(0, currentIndex - 3), currentIndex)
    .map((w) => `${w.name}——${w.script}`)
    .reverse()

  const stop = () => {
    useTourStore.getState().stop()
    setSceneMode('idle')
    setActivePanel('empty')
    focusCamera({ type: 'campus' })
  }

  if (!touring) {
    return (
      <div style={S.root}>
        <div style={S.empty}>
          校训地标巡礼:飞翔门 → 花坛钟 → 纪念鼎 → 章乃器铜像 → 百年门 → 墨湖图书馆。
          <br />
          <span style={{ opacity: 0.6 }}>讲到哪飞到哪,途中可随时打断追问。</span>
        </div>
        <button type="button" onClick={() => void submitCommand('带我逛逛商大')} style={S.primaryBtn}>
          <Play size={14} /> 开始巡礼
        </button>
      </div>
    )
  }

  return (
    <div style={S.root}>
      <div style={S.sectionTitle}><Compass size={12} style={{ verticalAlign: -2 }} /> 导游字幕</div>
      <div style={S.subtitleBox}>
        {finished ? (
          <div style={S.subtitleCurrent}>
            巡礼已结束,共 {total} 站。镜头已回到全校视角,随时可说「带我逛校园」再走一遍。
          </div>
        ) : wp ? (
          <>
            <div style={S.progress}>
              第 {currentIndex + 1}/{total} 站 · {wp.name}
              {status === 'paused' ? '(已暂停)' : ''}
            </div>
            <div style={S.subtitleCurrent}>{wp.script}</div>
          </>
        ) : (
          <div style={S.empty}>导游准备中…</div>
        )}
      </div>
      {history.length > 0 && !finished && (
        <div style={S.history}>
          {history.map((h, i) => (
            <div key={i} style={S.historyItem}>{h}</div>
          ))}
        </div>
      )}

      <div style={S.controls}>
        <button
          type="button"
          onClick={() => useTourStore.getState().prev()}
          disabled={finished || currentIndex === 0}
          style={S.ctrlBtn}
        >
          <ArrowLeft size={14} /> 上一站
        </button>
        <button
          type="button"
          onClick={() => {
            const t = useTourStore.getState()
            if (t.status === 'playing') t.pause()
            else t.resume()
          }}
          disabled={finished}
          style={S.ctrlBtn}
        >
          {status === 'playing' ? <><Pause size={14} /> 暂停</> : <><Play size={14} /> 继续</>}
        </button>
        <button
          type="button"
          onClick={() => useTourStore.getState().next()}
          disabled={finished || currentIndex >= total - 1}
          style={S.ctrlBtnPrimary}
        >
          下一站 <ArrowRight size={14} />
        </button>
        <button type="button" onClick={stop} style={S.ctrlBtnDanger}>
          <Square size={13} /> 结束
        </button>
      </div>
      <div style={S.tip}>拖动/滚轮可随时接管相机(巡礼暂停,点「继续」续游);也可在指令台说「上一站/下一站/暂停」。</div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  sectionTitle: { fontSize: 12, opacity: 0.55, letterSpacing: 1 },
  subtitleBox: {
    background: '#161b21', border: '1px solid #2a323b', borderLeft: '3px solid #e8b84b',
    borderRadius: 8, padding: '14px 14px', minHeight: 96,
  },
  progress: { fontSize: 12, opacity: 0.55, letterSpacing: 1, marginBottom: 8 },
  subtitleCurrent: { fontSize: 14.5, lineHeight: 1.9, color: '#dde3e8' },
  history: { display: 'flex', flexDirection: 'column', gap: 6 },
  historyItem: {
    fontSize: 12, opacity: 0.45, lineHeight: 1.6, padding: '6px 10px',
    background: '#14181d', borderRadius: 6, border: '1px solid #2a323b',
  },
  controls: { display: 'flex', gap: 8, marginTop: 2 },
  ctrlBtn: {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    background: 'none', border: '1px solid #2a323b', color: '#dde3e8',
    borderRadius: 6, padding: '8px 0', fontSize: 12.5, cursor: 'pointer',
  },
  ctrlBtnPrimary: {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    background: '#3aa7ff', border: 'none', color: '#0e1114',
    borderRadius: 6, padding: '8px 0', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  },
  ctrlBtnDanger: {
    flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
    background: 'none', border: '1px solid #ff3b3055', color: '#ff3b30',
    borderRadius: 6, padding: '8px 0', fontSize: 12.5, cursor: 'pointer',
  },
  tip: { fontSize: 11.5, opacity: 0.45, lineHeight: 1.6 },
  empty: { fontSize: 13, opacity: 0.8, lineHeight: 1.8 },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: '#3aa7ff', color: '#0e1114', border: 'none', borderRadius: 6,
    padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
}
