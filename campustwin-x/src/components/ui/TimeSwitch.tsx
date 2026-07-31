// 昼夜时间切换(右上角,画质开关下方):
// 自动 = 从当前真实时刻起 600 倍速流转(24 小时 ≈ 2.4 分钟,原地看完整黎明→正午→黄昏→深夜);
// 白天 = 锁当日 10:00;黄昏 = 锁当日日落前 25 分钟(golden hour);夜晚 = 锁当日日落后 90 分钟。
// 黄昏/夜晚时刻由 suncalc 动态计算(见 lib/sun.ts,与 sceneHandler 指令共用同一契约);
// 手动锁定一律恢复 speed=60(仿真引擎对 locked 时钟冻结推进,占用/人流同步定格)。
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Sun, Sunset, Moon, Clock } from 'lucide-react'
import { useSimStore } from '../../store/simStore'
import { getDuskMs, getNightMs } from '../../lib/sun'

type Choice = 'auto' | 'day' | 'dusk' | 'night'

/** 自动模式倍速:600× ≈ 2.4 分钟看完全天;手动锁定恢复 60× */
const AUTO_SPEED = 600
const LOCK_SPEED = 60

const ITEMS: { key: Choice; label: string; icon: typeof Sun }[] = [
  { key: 'auto', label: '自动', icon: Clock },
  { key: 'day', label: '白天', icon: Sun },
  { key: 'dusk', label: '黄昏', icon: Sunset },
  { key: 'night', label: '夜晚', icon: Moon },
]

export default function TimeSwitch() {
  const setSimClock = useSimStore((s) => s.setSimClock)
  const [choice, setChoice] = useState<Choice>('auto')

  const pick = (c: Choice) => {
    setChoice(c)
    switch (c) {
      case 'auto':
        // 回到真实时间,高速全日循环演示
        setSimClock({ nowMs: Date.now(), speed: AUTO_SPEED, locked: false })
        break
      case 'day': {
        const d = new Date()
        d.setHours(10, 0, 0, 0)
        setSimClock({ nowMs: d.getTime(), speed: LOCK_SPEED, locked: true })
        break
      }
      case 'dusk':
        // 当日日落前约 25 分钟(golden hour,随季节动态变化)
        setSimClock({ nowMs: getDuskMs(), speed: LOCK_SPEED, locked: true })
        break
      case 'night':
        // 当日日落后约 90 分钟(全黑 + 全灯)
        setSimClock({ nowMs: getNightMs(), speed: LOCK_SPEED, locked: true })
        break
    }
  }

  return (
    <div style={S.wrap}>
      {ITEMS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => pick(key)}
          title={`时间·${label}`}
          style={key === choice ? { ...S.btn, ...S.btnActive } : S.btn}
        >
          <Icon size={12} style={{ marginRight: 4, verticalAlign: -1.5 }} />
          {label}
        </button>
      ))}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    top: 52,
    right: 16,
    zIndex: 20,
    display: 'flex',
    gap: 2,
    padding: 3,
    background: '#161b21cc',
    border: '1px solid #2a323b',
    borderRadius: 6,
    userSelect: 'none',
  },
  btn: {
    display: 'flex',
    alignItems: 'center',
    border: 'none',
    background: 'transparent',
    color: '#dde3e8',
    fontSize: 11,
    lineHeight: 1,
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    opacity: 0.6,
    fontFamily: 'inherit',
  },
  btnActive: {
    background: 'rgba(58, 167, 255, 0.12)',
    color: '#3aa7ff',
    opacity: 1,
  },
}
