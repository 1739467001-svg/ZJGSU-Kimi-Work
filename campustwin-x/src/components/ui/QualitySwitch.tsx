// 画质分档开关(右上角小件):当前档 + 三档按钮 + 自动档开关
// 契约来源:uiStore.quality / autoQuality / setQuality / setAutoQuality
import type { CSSProperties } from 'react'
import { useUIStore, type Quality } from '../../store/uiStore'
import { QUALITY_ORDER, QUALITY_PRESETS } from '../../lib/quality'

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

  const pick = (q: Quality) => {
    // 手动选档即退出自动档,避免 PerformanceMonitor 立刻把用户选择降回去
    setQuality(q)
    if (autoQuality) setAutoQuality(false)
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
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
      <span style={{ opacity: 0.6 }}>画质</span>
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
          opacity: autoQuality ? 1 : 0.6,
          borderLeft: `1px solid ${COLORS.border}`,
          paddingLeft: 8,
        }}
      >
        <input
          type="checkbox"
          checked={autoQuality}
          onChange={(e) => setAutoQuality(e.target.checked)}
          style={{ accentColor: COLORS.brand, margin: 0, width: 12, height: 12 }}
        />
        自动
      </label>
    </div>
  )
}
