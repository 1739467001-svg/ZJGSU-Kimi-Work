import type { CSSProperties } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react'
import ChatInput from '../agent/ChatInput'
import ExampleChips from '../agent/ExampleChips'
import MessageList from '../agent/MessageList'
import AgentTimeline from '../agent/AgentTimeline'

interface CommandPanelProps {
  /** 抽屉模式(手机底部/平板侧边):宽度交给外层容器,不出现收起手柄 */
  drawer?: boolean
  /** 桌面端:收起到屏幕左缘 rail(宽度 320 → 44) */
  collapsed?: boolean
  onToggleCollapse?: () => void
}

/** 左栏指挥台:标题 + 消息流 + 执行链 + 示例指令 + 输入栏。
 *  桌面:320px 全高侧栏,可靠右缘手柄收起到左缘 rail(点击 rail 展开);
 *  抽屉模式:宽度 100% 交由外层抽屉容器。 */
export default function CommandPanel({
  drawer = false,
  collapsed = false,
  onToggleCollapse,
}: CommandPanelProps) {
  const panelStyle: CSSProperties = drawer
    ? { ...styles.panel, ...styles.panelDrawer }
    : { ...styles.panel, width: collapsed ? 44 : 320 }
  const faded = !drawer && collapsed

  return (
    <aside style={panelStyle}>
      {/* 面板主体:定宽 320,收起时 aside 收窄 + overflow 裁剪(不重排),内容淡出 */}
      <div
        style={{
          ...styles.inner,
          width: drawer ? '100%' : 320,
          opacity: faded ? 0 : 1,
          pointerEvents: faded ? 'none' : 'auto',
        }}
      >
        <header style={styles.header}>
          <span style={styles.dot} />
          <h2 style={styles.title}>一句话指挥台</h2>
        </header>
        <MessageList />
        <AgentTimeline />
        <ExampleChips />
        <ChatInput />
      </div>

      {/* 桌面展开态:靠中间一侧(右缘)的收起手柄 */}
      {!drawer && !collapsed && (
        <button
          type="button"
          style={styles.handle}
          onClick={onToggleCollapse}
          title="收起指令台"
          aria-label="收起指令台"
        >
          <ChevronLeft size={14} />
        </button>
      )}

      {/* 桌面收起态:左缘 rail,整条可点击展开 */}
      {!drawer && collapsed && (
        <button
          type="button"
          style={styles.railBtn}
          onClick={onToggleCollapse}
          title="展开指令台"
          aria-label="展开指令台"
        >
          <ChevronRight size={14} />
          <MessageSquare size={16} />
          <span style={styles.railText}>指令台</span>
        </button>
      )}
    </aside>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    position: 'relative',
    width: 320,
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    background: '#14181d',
    borderRight: '1px solid #2a323b',
    color: '#dde3e8',
    overflow: 'hidden',
    transition: 'width 0.3s ease',
  },
  // 抽屉模式:填满外层抽屉容器(背景/圆角/阴影由容器负责),不做宽度动画
  panelDrawer: {
    width: '100%',
    borderRight: 'none',
    background: 'transparent',
    transition: 'none',
  },
  inner: {
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    transition: 'opacity 0.2s ease',
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
  handle: {
    position: 'absolute',
    top: '50%',
    right: 0,
    transform: 'translateY(-50%)',
    width: 20,
    height: 64,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#161b21',
    border: '1px solid #2a323b',
    borderRight: 'none',
    borderRadius: '6px 0 0 6px',
    color: '#9aa4ae',
    cursor: 'pointer',
    zIndex: 5,
  },
  railBtn: {
    position: 'absolute',
    inset: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    background: 'transparent',
    border: 'none',
    color: '#9aa4ae',
    cursor: 'pointer',
    fontFamily: 'inherit',
    zIndex: 5,
  },
  railText: {
    writingMode: 'vertical-rl',
    fontSize: 12,
    letterSpacing: 2,
  },
}
