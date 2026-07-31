// HTTP 数据源骨架:面向真实后端(学校预约系统 / 后勤工单系统 / 能耗 API)。
// 约定(详见 README.md):
//   GET  /rooms                 -> { rooms: Room[] }            全量房源(含排期)
//   POST /rooms/search          -> { rooms: Room[] }            条件检索,body = RoomQuery
//   POST /bookings              -> Booking                      创建预约单,body = CreateBookingInput
//   POST /tickets               -> Ticket                       创建报修工单,body = CreateTicketInput
//   GET  /overview/snapshot     -> OverviewSnapshot             校园运行快照(占用率/能耗)
// 未配置 baseUrl 时 createHttpDataSource 返回 null,由工厂回退 Mock。
import type { Booking, CreateBookingInput, CreateTicketInput, Room, Ticket } from '../agentTypes'
import type { RoomQuery } from '../rooms'
import type {
  BookingDataSource,
  CampusDataSource,
  HttpDataSourceConfig,
  OverviewDataSource,
  OverviewSnapshot,
  RepairDataSource,
} from './types'

/** 数据源统一错误:网络失败 / 超时 / 非 2xx 都会归一到本类型 */
export class DataSourceError extends Error {
  /** HTTP 状态码(网络层失败时为空) */
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'DataSourceError'
    this.status = status
  }
}

interface ResolvedConfig {
  baseUrl: string
  token?: string
  timeoutMs: number
}

const DEFAULT_TIMEOUT_MS = 8000

/** 带超时与鉴权的 fetch 封装;所有错误归一为 DataSourceError */
async function fetchJson<T>(cfg: ResolvedConfig, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
        ...init?.headers,
      },
    })
    if (!res.ok) {
      throw new DataSourceError(`HTTP ${res.status} ${res.statusText} @ ${path}`, res.status)
    }
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof DataSourceError) throw e
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new DataSourceError(`请求超时(${cfg.timeoutMs}ms)@ ${path}`)
    }
    throw new DataSourceError(e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

function createHttpBookingDataSource(cfg: ResolvedConfig): BookingDataSource {
  return {
    async listRooms(): Promise<Room[]> {
      const data = await fetchJson<{ rooms: Room[] }>(cfg, '/rooms')
      return data.rooms
    },
    async searchRooms(query: RoomQuery): Promise<Room[]> {
      const data = await fetchJson<{ rooms: Room[] }>(cfg, '/rooms/search', post(query))
      return data.rooms
    },
    async createBooking(input: CreateBookingInput): Promise<Booking> {
      return fetchJson<Booking>(cfg, '/bookings', post(input))
    },
  }
}

function createHttpRepairDataSource(cfg: ResolvedConfig): RepairDataSource {
  return {
    async listRooms(): Promise<Room[]> {
      const data = await fetchJson<{ rooms: Room[] }>(cfg, '/rooms')
      return data.rooms
    },
    async createTicket(input: CreateTicketInput): Promise<Ticket> {
      return fetchJson<Ticket>(cfg, '/tickets', post(input))
    },
  }
}

function createHttpOverviewDataSource(cfg: ResolvedConfig): OverviewDataSource {
  return {
    async getOverview(): Promise<OverviewSnapshot> {
      const snap = await fetchJson<OverviewSnapshot>(cfg, '/overview/snapshot')
      return { ...snap, origin: 'remote' }
    },
  }
}

/**
 * 组装 HTTP 数据源;baseUrl 为空(未配置真实后端)时返回 null。
 * 注意:此处只做配置判定,不做连通性探测 —— 运行时失败由 index.ts 的回退包装兜底。
 */
export function createHttpDataSource(config?: HttpDataSourceConfig): CampusDataSource | null {
  if (!config?.baseUrl) return null
  const cfg: ResolvedConfig = {
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    token: config.token,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
  return {
    booking: createHttpBookingDataSource(cfg),
    repair: createHttpRepairDataSource(cfg),
    overview: createHttpOverviewDataSource(cfg),
  }
}
