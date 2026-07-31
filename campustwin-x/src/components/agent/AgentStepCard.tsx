import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { Check, CircleDashed, Loader2, X } from 'lucide-react'
import type { AgentStep } from '../../lib/agentTypes'

interface StatusStyle {
  color: string
  border: string
  icon: typeof Check
  spin: boolean
  pulse: boolean
}

const STATUS_STYLE: Record<AgentStep['status'], StatusStyle> = {
  waiting: { color: '#7a8288', border: '#2a323b', icon: CircleDashed, spin: false, pulse: false },
  running: { color: '#3aa7ff', border: '#3aa7ff', icon: Loader2, spin: true, pulse: true },
  done: { color: '#3fd08c', border: '#3fd08c', icon: Check, spin: false, pulse: false },
  error: { color: '#ff3b30', border: '#ff3b30', icon: X, spin: false, pulse: false },
}

/** 单个 Agent 步骤卡:等待=灰 / 运行=品牌蓝呼吸 / 完成=绿勾 / 错误=红叉 */
export default function AgentStepCard({ step }: { step: AgentStep }) {
  const st = STATUS_STYLE[step.status]
  const Icon = st.icon

  return (
    <motion.div
      style={{ ...styles.card, borderLeftColor: st.border }}
      animate={
        st.pulse
          ? { opacity: [1, 0.55, 1], boxShadow: [
              '0 0 0 rgba(58,167,255,0)',
              '0 0 12px rgba(58,167,255,0.35)',
              '0 0 0 rgba(58,167,255,0)',
            ] }
          : { opacity: step.status === 'waiting' ? 0.75 : 1, boxShadow: '0 0 0 rgba(58,167,255,0)' }
      }
      transition={
        st.pulse
          ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.3 }
      }
    >
      <span style={{ ...styles.icon, color: st.color, borderColor: st.border }}>
        <motion.span
          style={{ display: 'flex' }}
          animate={st.spin ? { rotate: 360 } : { rotate: 0 }}
          transition={st.spin ? { duration: 1, repeat: Infinity, ease: 'linear' } : { duration: 0.2 }}
        >
          <Icon size={13} strokeWidth={2.5} />
        </motion.span>
      </span>
      <div style={styles.body}>
        <div style={styles.head}>
          <span style={styles.title}>{step.title}</span>
          <span style={{ ...styles.badge, color: st.color, borderColor: st.border }}>
            {step.agent}
          </span>
        </div>
        {step.detail ? <div style={styles.detail}>{step.detail}</div> : null}
      </div>
    </motion.div>
  )
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    background: '#161b21',
    border: '1px solid #2a323b',
    borderLeft: '3px solid #2a323b',
    borderRadius: 6,
    padding: '8px 10px',
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
    borderRadius: '50%',
    border: '1px solid #2a323b',
    flexShrink: 0,
    marginTop: 1,
  },
  body: { flex: 1, minWidth: 0 },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 12,
    fontWeight: 600,
    color: '#dde3e8',
    lineHeight: '18px',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  badge: {
    flexShrink: 0,
    fontSize: 10,
    lineHeight: '16px',
    padding: '0 6px',
    borderRadius: 999,
    border: '1px solid #2a323b',
    background: '#0e1114',
  },
  detail: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: '16px',
    color: '#dde3e8',
    opacity: 0.6,
    wordBreak: 'break-word',
  },
}
