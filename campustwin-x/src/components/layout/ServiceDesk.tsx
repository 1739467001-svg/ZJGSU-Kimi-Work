import { useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Building2, CalendarCheck, ChevronLeft, ChevronRight, Compass, LayoutDashboard, Navigation, Ticket, Wrench, X } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import { useSidebarCollapsed } from '../ui/useSidebarCollapsed'
import { BookingPanel } from '../service/BookingPanel'
import { RepairPanel } from '../service/RepairPanel'
import { OverviewPanel } from '../service/OverviewPanel'
import { NavigationPanel } from '../service/NavigationPanel'
import { TourPanel } from '../service/TourPanel'

type PanelKey = 'booking' | 'repair' | 'overview' | 'navigation' | 'tour' | 'empty'

const PANEL_META: Record<PanelKey, { title: string; icon: ReactNode }> = {
  booking: { title: '空间预约', icon: <CalendarCheck size={15} color="#3aa7ff" /> },
  repair: { title: '报修工单', icon: <Wrench size={15} color="#e8b84b" /> },
  overview: { title: '校园态势', icon: <LayoutDashboard size={15} color="#3fd08c" /> },
  navigation: { title: '校园导航', icon: <Navigation size={15} color="#3aa7ff" /> },
  tour: { title: 'AI 导游', icon: <Compass size={15} color="#e8b84b" /> },
  empty: { title: '校园服务总览', icon: <LayoutDashboard size={15} color="#dde3e8" /> },
}

/** 右栏服务台:按 activePanel 切换各业务面板(Framer Motion 滑入),宽 360px。
 *  桌面/平板:可靠左缘手柄收起到右缘 rail(点击 rail 展开);
 *  AI 打开业务面板(activePanel 变化)时若处于收起态会自动展开。
 *  sheet 模式(手机底部抽屉):填满外层容器,头部附「收起抽屉」按钮。 */
export function ServiceDesk({ sheet = false, onClose }: { sheet?: boolean; onClose?: () => void }) {
  const activePanel = useCampusStore((s) => s.activePanel)
  const setActivePanel = useCampusStore((s) => s.setActivePanel)
  const [collapsed, setCollapsed] = useSidebarCollapsed('right')

  // AI 指令打开业务面板时,收起态的右栏自动展开,避免用户看不到面板结果
  useEffect(() => {
    if (!sheet && activePanel !== 'empty') setCollapsed(false)
  }, [activePanel, sheet, setCollapsed])

  const meta = PANEL_META[activePanel]
  const deskStyle: CSSProperties = sheet
    ? { ...S.desk, ...S.deskSheet }
    : { ...S.desk, width: collapsed ? 44 : 360 }
  const faded = !sheet && collapsed

  return (
    <aside style={deskStyle}>
      {/* 面板主体:定宽 360,收起时 aside 收窄 + overflow 裁剪(不重排),内容淡出 */}
      <div
        style={{
          ...S.inner,
          width: sheet ? '100%' : 360,
          opacity: faded ? 0 : 1,
          pointerEvents: faded ? 'none' : 'auto',
        }}
      >
        <header style={S.header}>
          <span style={S.headerIcon}>{meta.icon}</span>
          <span style={S.headerTitle}>{meta.title}</span>
          {activePanel !== 'empty' && (
            <button type="button" onClick={() => setActivePanel('empty')} style={S.closeBtn} title="返回总览">
              <X size={14} />
            </button>
          )}
          {sheet && (
            <button
              type="button"
              onClick={onClose}
              style={{ ...S.closeBtn, marginLeft: activePanel !== 'empty' ? 0 : 'auto' }}
              title="收起服务台"
              aria-label="收起服务台"
            >
              <X size={14} />
            </button>
          )}
        </header>
        <div style={S.body}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activePanel}
              initial={{ x: 48, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 48, opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              {activePanel === 'booking' && <BookingPanel />}
              {activePanel === 'repair' && <RepairPanel />}
              {activePanel === 'overview' && <OverviewPanel />}
              {activePanel === 'navigation' && <NavigationPanel />}
              {activePanel === 'tour' && <TourPanel />}
              {activePanel === 'empty' && <EmptySummary />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* 桌面/平板展开态:靠中间一侧(左缘)的收起手柄 */}
      {!sheet && !collapsed && (
        <button
          type="button"
          style={S.handle}
          onClick={() => setCollapsed(true)}
          title="收起服务台"
          aria-label="收起服务台"
        >
          <ChevronRight size={14} />
        </button>
      )}

      {/* 桌面/平板收起态:右缘 rail,整条可点击展开 */}
      {!sheet && collapsed && (
        <button
          type="button"
          style={S.railBtn}
          onClick={() => setCollapsed(false)}
          title="展开服务台"
          aria-label="展开服务台"
        >
          <ChevronLeft size={14} />
          <LayoutDashboard size={16} />
          <span style={S.railText}>服务台</span>
        </button>
      )}
    </aside>
  )
}

/** 空态:『校园服务总览』摘要卡 */
function EmptySummary() {
  const buildings = useCampusStore((s) => s.buildings)
  const rooms = useCampusStore((s) => s.rooms)
  const bookings = useCampusStore((s) => s.bookings)
  const tickets = useCampusStore((s) => s.tickets)

  const named = buildings.filter((b) => b.name).length
  const freeRooms = rooms.filter((r) => r.status === 'free').length
  const openTickets = tickets.filter((t) => t.status !== 'done').length

  return (
    <div style={S.emptyRoot}>
      <div style={S.summaryCard}>
        <div style={S.summaryTitle}>浙江工商大学 · 下沙校区</div>
        <div style={S.summaryRow}><Building2 size={13} /> 楼宇 {buildings.length} 栋(实名 {named})</div>
        <div style={S.summaryRow}><CalendarCheck size={13} /> 空间 {rooms.length} 间 · 当前空闲 {freeRooms}</div>
        <div style={S.summaryRow}><Ticket size={13} /> 今日预约 {bookings.length} 笔 · 待办工单 {openTickets} 件</div>
      </div>
      <div style={S.hintCard}>
        <div style={S.hintTitle}>在指令台说一句话,服务台自动接管:</div>
        <div style={S.hintItem}>「帮我找一个有投影、能坐 8 人的会议室」</div>
        <div style={S.hintItem}>「C 教 302 投影坏了」</div>
        <div style={S.hintItem}>「看一下现在全校哪里最紧张」</div>
        <div style={S.hintItem}>「从南大门到文体中心怎么走」</div>
        <div style={S.hintItem}>「带我逛逛商大」</div>
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  desk: {
    position: 'absolute', top: 0, right: 0, bottom: 0, width: 360,
    background: '#14181d', borderLeft: '1px solid #2a323b',
    display: 'flex', flexDirection: 'column', zIndex: 20,
    boxShadow: '-12px 0 32px rgba(0,0,0,0.35)',
    overflow: 'hidden',
    transition: 'width 0.3s ease',
  },
  // 底部抽屉模式:脱离绝对定位,填满外层抽屉容器
  deskSheet: {
    position: 'relative', top: 'auto', right: 'auto', bottom: 'auto',
    width: '100%', height: '100%', borderLeft: 'none', boxShadow: 'none',
    background: 'transparent', flex: 1, minHeight: 0, transition: 'none',
  },
  inner: {
    height: '100%',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    transition: 'opacity 0.2s ease',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
    borderBottom: '1px solid #2a323b', background: '#161b21', flexShrink: 0,
  },
  headerIcon: { display: 'inline-flex', alignItems: 'center' },
  headerTitle: { fontSize: 14, fontWeight: 600, letterSpacing: 0.5 },
  closeBtn: {
    marginLeft: 'auto', background: 'none', border: '1px solid #2a323b', borderRadius: 5,
    color: '#dde3e8', width: 24, height: 24, display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', opacity: 0.7,
  },
  handle: {
    position: 'absolute', top: '50%', left: 0, transform: 'translateY(-50%)',
    width: 20, height: 64, padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#161b21', border: '1px solid #2a323b', borderLeft: 'none',
    borderRadius: '0 6px 6px 0', color: '#9aa4ae', cursor: 'pointer', zIndex: 5,
  },
  railBtn: {
    position: 'absolute', inset: 0, padding: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 10, background: 'transparent', border: 'none',
    color: '#9aa4ae', cursor: 'pointer', fontFamily: 'inherit', zIndex: 5,
  },
  railText: { writingMode: 'vertical-rl', fontSize: 12, letterSpacing: 2 },
  body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' },
  emptyRoot: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  summaryCard: {
    background: '#161b21', border: '1px solid #2a323b', borderRadius: 10,
    padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8,
  },
  summaryTitle: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  summaryRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, opacity: 0.85 },
  hintCard: {
    background: '#161b21', border: '1px solid #2a323b', borderRadius: 10,
    padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 7,
  },
  hintTitle: { fontSize: 12, opacity: 0.55, marginBottom: 2 },
  hintItem: {
    fontSize: 12.5, color: '#3aa7ff', opacity: 0.9, lineHeight: 1.5,
    paddingLeft: 10, borderLeft: '2px solid #2a323b',
  },
}
