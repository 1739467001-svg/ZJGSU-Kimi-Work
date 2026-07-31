import type { CSSProperties } from 'react'
import ChatInput from '../agent/ChatInput'
import ExampleChips from '../agent/ExampleChips'
import MessageList from '../agent/MessageList'
import AgentTimeline from '../agent/AgentTimeline'

/** 左栏指挥台:标题 + 消息流 + 执行链 + 示例指令 + 输入栏,320px 全高 */
export default function CommandPanel() {
  return (
    <aside style={styles.panel}>
      <header style={styles.header}>
        <span style={styles.dot} />
        <h2 style={styles.title}>一句话指挥台</h2>
      </header>
      <MessageList />
      <AgentTimeline />
      <ExampleChips />
      <ChatInput />
    </aside>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    width: 320,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#14181d',
    borderRight: '1px solid #2a323b',
    color: '#dde3e8',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 14px',
    borderBottom: '1px solid #2a323b',
    background: '#161b21',
    flexShrink: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#3aa7ff',
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: 1,
    color: '#dde3e8',
  },
}
