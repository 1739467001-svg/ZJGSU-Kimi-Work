import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { ArrowLeft, ArrowRight, Compass, Play, Square } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'

/**
 * 导游面板:字幕式导游(讲解词来自 导游Agent 消息流)。
 * 上一站/下一站/结束通过指令契约下发;巡礼控制状态(tourStore)为后续集成遗留点。
 */
export function TourPanel() {
  const messages = useCampusStore((s) => s.messages)
  const sceneMode = useCampusStore((s) => s.sceneMode)
  const submitCommand = useCampusStore((s) => s.submitCommand)
  const setSceneMode = useCampusStore((s) => s.setSceneMode)
  const setActivePanel = useCampusStore((s) => s.setActivePanel)
  const focusCamera = useCampusStore((s) => s.focusCamera)

  const touring = sceneMode === 'tour'

  // 字幕:导游期间的 Agent 消息,最新一条为主字幕,其余为历史
  const subtitles = useMemo(() => {
    const agentMsgs = messages.filter((m) => m.role === 'agent')
    if (!touring) return { current: null as string | null, history: [] as string[] }
    return {
      current: agentMsgs[agentMsgs.length - 1]?.text ?? null,
      history: agentMsgs.slice(-4, -1).map((m) => m.text).reverse(),
    }
  }, [messages, touring])

  const stop = () => {
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
        {subtitles.current ? (
          <div style={S.subtitleCurrent}>{subtitles.current}</div>
        ) : (
          <div style={S.empty}>导游准备中…</div>
        )}
      </div>
      {subtitles.history.length > 0 && (
        <div style={S.history}>
          {subtitles.history.map((h, i) => (
            <div key={i} style={S.historyItem}>{h}</div>
          ))}
        </div>
      )}

      <div style={S.controls}>
        <button type="button" onClick={() => void submitCommand('上一站')} style={S.ctrlBtn}>
          <ArrowLeft size={14} /> 上一站
        </button>
        <button type="button" onClick={() => void submitCommand('下一站')} style={S.ctrlBtnPrimary}>
          下一站 <ArrowRight size={14} />
        </button>
        <button type="button" onClick={stop} style={S.ctrlBtnDanger}>
          <Square size={13} /> 结束
        </button>
      </div>
      <div style={S.tip}>途中可直接在指令台追问,如「综合大楼多少层?」,答完自动续游。</div>
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
