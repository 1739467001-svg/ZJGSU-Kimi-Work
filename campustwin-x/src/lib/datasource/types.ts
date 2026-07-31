// 数据源适配层类型契约:handler 只依赖本层接口,不关心背后是 Mock 还是真实后端
// 业务实体类型复用 lib/agentTypes.ts 与 lib/rooms.ts,不在本层重复定义
import type { Booking, CreateBookingInput, CreateTicketInput, Room, Ticket } from '../agentTypes'
import type { RoomQuery } from '../rooms'

/** 态势快照:按楼宇的占用率与能耗(字段形状与 simStore 对齐) */
export interface OverviewSnapshot {
  /** buildingId -> 0..1 占用率 */
  buildingOccupancy: Record<string, number>
  /** buildingId -> kWh(今日累计) */
  buildingEnergy: Record<string, number>
  /** 数据来源标识,便于时间线展示与排障 */
  origin: 'sim' | 'static' | 'remote'
}

/** 预约域数据源:房源检索 + 下单(未来对接学校会议室/教室预约系统) */
export interface BookingDataSource {
  /** 全量房源(带排期),供楼宇消歧与 3D 高亮使用 */
  listRooms(): Promise<Room[]>
  /** 条件检索;HTTP 实现可下推服务端,Mock 实现本地过滤 */
  searchRooms(query: RoomQuery): Promise<Room[]>
  /** 创建预约单 */
  createBooking(input: CreateBookingInput): Promise<Booking>
}

/** 报修域数据源:房间定位 + 工单(未来对接后勤工单系统) */
export interface RepairDataSource {
  /** 全量房源,供「房间号 → Room」匹配 */
  listRooms(): Promise<Room[]>
  /** 创建报修工单 */
  createTicket(input: CreateTicketInput): Promise<Ticket>
}

/** 态势域数据源:校园运行快照(未来对接能耗/客流 API) */
export interface OverviewDataSource {
  getOverview(): Promise<OverviewSnapshot>
}

/** 聚合门面:一个注入点覆盖三个领域 */
export interface CampusDataSource {
  booking: BookingDataSource
  repair: RepairDataSource
  overview: OverviewDataSource
}

/** HTTP 数据源配置;baseUrl 为空视为「未配置」,工厂会自动回退 Mock */
export interface HttpDataSourceConfig {
  baseUrl?: string
  /** Bearer token;空则不携带鉴权头 */
  token?: string
  /** 单次请求超时毫秒数,默认 8000 */
  timeoutMs?: number
}
