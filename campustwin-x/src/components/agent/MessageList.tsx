import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { Bot } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'

const fmtTime = (ts: number): string =>
  new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

/** 用户 / Agent 消息流,深色气泡 + 时间戳,自动滚动到底部 */
export default function MessageList() {
  const messages = useCampusStore((s) => s.messages)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <div ref={scrollRef} style={styles.scroll}>
      {messages.length === 0 ? (
        <div style={styles.empty}>
          <Bot size={22} style={{ opacity: 0.5 }} />
          <div style={styles.emptyTitle}>等待指令</div>
          <div style={styles.emptySub}>用一句话调度会议室、报修、导航或查看校园态势</div>
        </div>
      ) : (
        messages.map((m) => {
          const isUser = m.role === 'user'
          return (
            <div
              key={m.id}
              style={{
                ...styles.row,
                justifyContent: isUser ? 'flex-end' : 'flex-start',
              }}
            >
              <div
                style={{
                  ...styles.bubble,
                  ...(isUser ? styles.userBubble : styles.agentBubble),
                }}
              >
                <div style={styles.text}>{m.text}</div>
                <div style={styles.time}>{fmtTime(m.ts)}</div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px 12px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  empty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    color: '#dde3e8',
    textAlign: 'center',
  },
  emptyTitle: { fontSize: 13, fontWeight: 600 },
  emptySub: { fontSize: 11, opacity: 0.6, lineHeight: '17px' },
  row: { display: 'flex' },
  bubble: {
    maxWidth: '85%',
    borderRadius: 8,
    padding: '8px 10px 6px',
    border: '1px solid #2a323b',
  },
  userBubble: {
    background: '#3aa7ff',
    borderColor: '#3aa7ff',
    color: '#0e1114',
  },
  agentBubble: {
    background: '#161b21',
    color: '#dde3e8',
  },
  text: {
    fontSize: 13,
    lineHeight: '19px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  time: {
    marginTop: 4,
    fontSize: 10,
    opacity: 0.6,
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
}
