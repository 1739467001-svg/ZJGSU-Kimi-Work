// 画质分档开关(右上角小件):当前档 + 三档按钮 + 自动档开关
// 契约来源:uiStore.quality / autoQuality / setQuality / setAutoQuality
import type { CSSProperties } from 'react'
import { useUIStore, type Quality } from '../../store/uiStore'
import { QUALITY_ORDER, QUALITY_PRESETS } from '../../lib/quality'
import { useIsMobile } from './useMediaQuery'

const COLORS = {
  panel: '#161b21',
  border: '#2a323b',
  text: '#dde3e8',
  brand: '#3aa7ff',
  gold: '#e8b84b',
}

const btnBase: CSSProperties = {
  border: `1px solid ${COLORS.border}`,
  background: 'transparent',
  color: COLORS.text,
  fontSize: 11,
  lineHeight: 1,
  padding: '5px 8px',
  borderRadius: 4,
  cursor: 'pointer',
  opacity: 0.6,
}

const btnActive: CSSProperties = {
  ...btnBase,
  border: `1px solid ${COLORS.brand}`,
  color: COLORS.brand,
  opacity: 1,
  background: 'rgba(58, 167, 255, 0.08)',
}

export default function QualitySwitch() {
  const quality = useUIStore((s) => s.quality)
  const autoQuality = useUIStore((s) => s.autoQuality)
  const setQuality = useUIStore((s) => s.setQuality)
  const setAutoQuality = useUIStore((s) => s.setAutoQuality)
  const mode = useUIStore((s) => s.mode)
  const isMobile = useIsMobile()

  const pick = (q: Quality) => {
    // 手动选档即退出自动档,避免 PerformanceMonitor 立刻把用户选择降回去
    setQuality(q)
    if (autoQuality) setAutoQuality(false)
  }

  return (
    <div
      style={{
        position: 'absolute',
        // 手机端:让位给顶部居中的模式开关,收纳到其下方右缘并避让刘海
        top: isMobile
          ? mode === 'immersive'
            ? 'calc(96px + var(--sat, 0px))'
            : 'calc(62px + var(--sat, 0px))'
          : 16,
        right: isMobile ? 'calc(8px + var(--sar, 0px))' : 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 6 : 8,
        padding: isMobile ? '5px 8px' : '6px 10px',
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 6,
        color: COLORS.text,
        fontSize: 11,
        fontFamily: 'inherit',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      {!isMobile && <span style={{ opacity: 0.6 }}>画质</span>}
      <span style={{ color: COLORS.gold, minWidth: 14, textAlign: 'center' }}>
        {QUALITY_PRESETS[quality].label}
      </span>
      <div style={{ display: 'flex', gap: 4 }}>
        {QUALITY_ORDER.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => pick(q)}
            title={`画质·${QUALITY_PRESETS[q].label}`}
            style={q === quality ? btnActive : btnBase}
          >
            {QUALITY_PRESETS[q].label}
          </button>
        ))}
      </div>
      <label
        title="自动降档"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          opacity: autoQuality ? 1 : 0.6,
          borderLeft: `1px solid ${COLORS.border}`,
          paddingLeft: isMobile ? 6 : 8,
        }}
      >
        <input
          type="checkbox"
          checked={autoQuality}
          onChange={(e) => setAutoQuality(e.target.checked)}
          style={{ accentColor: COLORS.brand, margin: 0, width: 12, height: 12 }}
        />
        {!isMobile && '自动'}
      </label>
    </div>
  )
}
