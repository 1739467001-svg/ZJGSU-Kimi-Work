// LocateButton —— 三个服务面板共用的「定位」按钮(M4 房间级点对点定位)。
// 统一样式与"正在定位"态:locating=true 时图标切换为旋转 Loader2 并高亮。
import type { CSSProperties } from 'react'
import { Crosshair, Loader2 } from 'lucide-react'

const SPIN_CSS = '@keyframes ct-locate-spin{to{transform:rotate(360deg)}}'
const spinStyle: CSSProperties = { animation: 'ct-locate-spin 0.9s linear infinite' }

export interface LocateButtonProps {
  /** 正在定位到本房间(campusStore.locatingRoomId 命中自己) */
  locating: boolean
  onClick: () => void
  /** 传入则渲染完整文字按钮;省略则渲染图标小按钮 */
  label?: string
  title?: string
}

export function LocateButton({ locating, onClick, label, title }: LocateButtonProps) {
  const Icon = locating ? Loader2 : Crosshair
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title ?? (label || '定位到房间')}
      style={label ? { ...S.full, ...(locating ? S.fullLocating : null) } : { ...S.icon, ...(locating ? S.iconLocating : null) }}
    >
      <style>{SPIN_CSS}</style>
      <Icon size={label ? 13 : 12} style={locating ? spinStyle : undefined} />
      {label ? <span>{locating ? '定位中…' : label}</span> : null}
    </button>
  )
}

const S: Record<string, CSSProperties> = {
  icon: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 24, height: 24, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
    background: 'none', border: '1px solid #3aa7ff55', color: '#3aa7ff',
  },
  iconLocating: { borderColor: '#e8b84b', color: '#e8b84b', background: '#e8b84b14' },
  full: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: 'none', color: '#3aa7ff', border: '1px solid #3aa7ff55', borderRadius: 6,
    padding: '8px 12px', fontSize: 12.5, cursor: 'pointer',
  },
  fullLocating: { borderColor: '#e8b84b', color: '#e8b84b', background: '#e8b84b14' },
}
