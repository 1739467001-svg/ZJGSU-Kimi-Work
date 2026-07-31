import type { CSSProperties } from 'react'
import { CalendarSearch, Wrench, Gauge } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'

interface Example {
  icon: typeof CalendarSearch
  label: string
  command: string
}

const EXAMPLES: Example[] = [
  { icon: CalendarSearch, label: '找会议室', command: '帮我找一个明天下午能容纳 10 人的会议室' },
  { icon: Wrench, label: '报修', command: '我要报修:C302 的投影仪坏了' },
  { icon: Gauge, label: '看态势', command: '看一下当前校园运行态势' },
]

/** 示例指令快捷入口,点击即提交 */
export default function ExampleChips() {
  const submitCommand = useCampusStore((s) => s.submitCommand)

  return (
    <div style={styles.wrap}>
      <div style={styles.hint}>试试这些指令</div>
      <div style={styles.chips}>
        {EXAMPLES.map((ex) => {
          const Icon = ex.icon
          return (
            <button
              key={ex.label}
              type="button"
              style={styles.chip}
              onClick={() => void submitCommand(ex.command)}
              title={ex.command}
            >
              <Icon size={13} />
              <span>{ex.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    padding: '10px 12px 8px',
    borderTop: '1px solid #2a323b',
    background: '#14181d',
    flexShrink: 0,
  },
  hint: {
    fontSize: 11,
    color: '#dde3e8',
    opacity: 0.6,
    marginBottom: 8,
  },
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '5px 10px',
    fontSize: 12,
    color: '#dde3e8',
    background: '#161b21',
    border: '1px solid #2a323b',
    borderRadius: 999,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
}
