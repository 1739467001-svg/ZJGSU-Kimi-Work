import type { CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCampusStore } from '../../store/campusStore'
import AgentStepCard from './AgentStepCard'

/** Agent 执行步骤时间线,Framer Motion stagger 入场 */
export default function AgentTimeline() {
  const agentSteps = useCampusStore((s) => s.agentSteps)

  if (agentSteps.length === 0) return null

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>执行链</div>
      <motion.div
        style={styles.list}
        initial="hidden"
        animate="show"
        variants={{
          hidden: {},
          show: { transition: { staggerChildren: 0.09 } },
        }}
      >
        <AnimatePresence initial={false}>
          {agentSteps.map((step) => (
            <motion.div
              key={step.id}
              variants={{
                hidden: { opacity: 0, x: -14 },
                show: { opacity: 1, x: 0, transition: { duration: 0.25 } },
              }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <AgentStepCard step={step} />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    borderTop: '1px solid #2a323b',
    background: '#14181d',
    padding: '8px 12px 10px',
    flexShrink: 0,
    maxHeight: '42%',
    overflowY: 'auto',
  },
  header: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    color: '#dde3e8',
    opacity: 0.6,
    marginBottom: 8,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
}
