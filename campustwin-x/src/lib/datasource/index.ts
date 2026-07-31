// 数据源门面:按配置组装 Mock / Http(可选运行时回退),并维护进程内单例。
// handler 层只认 CampusDataSource 接口,通过 getDataSource() 或 HandlerContext 注入获取。
import { createHttpDataSource } from './http'
import { createMockDataSource } from './mock'
import type { MockDataSourceOptions } from './mock'
import type { CampusDataSource, HttpDataSourceConfig } from './types'

export type { CampusDataSource, HttpDataSourceConfig, OverviewSnapshot } from './types'
export type { BookingDataSource, OverviewDataSource, RepairDataSource } from './types'
export type { MockDataSourceOptions } from './mock'
export { DataSourceError, createHttpDataSource } from './http'
export { createMockDataSource } from './mock'

export interface DataSourceFactoryOptions extends MockDataSourceOptions {
  /** 真实后端配置;缺省或 baseUrl 为空 → 纯 Mock */
  http?: HttpDataSourceConfig
  /** HTTP 运行时失败(网络/超时/5xx)是否自动回退 Mock,默认 true */
  fallbackToMock?: boolean
}

/** 单方法级回退包装:主源抛错时告警并降级到备用源,保证指挥台永远有响应 */
function withFallback<T extends unknown[], R>(
  label: string,
  primary: (...args: T) => Promise<R>,
  fallback: (...args: T) => Promise<R>,
): (...args: T) => Promise<R> {
  return async (...args: T) => {
    try {
      return await primary(...args)
    } catch (e) {
      console.warn(`[datasource] ${label} 请求失败,已回退 Mock:`, e instanceof Error ? e.message : e)
      return fallback(...args)
    }
  }
}

function withFallbackDomain<D extends object>(
  primary: D,
  fallback: D,
): D {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(primary) as (keyof D)[]) {
    const p = primary[key]
    const f = fallback[key]
    out[key as string] =
      typeof p === 'function'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          withFallback(String(key), p as (...a: any[]) => Promise<unknown>, f as (...a: any[]) => Promise<unknown>)
        : p
  }
  return out as unknown as D
}

/** 组装数据源:Http(可选回退) 或纯 Mock */
export function createDataSource(opts?: DataSourceFactoryOptions): CampusDataSource {
  const mock = createMockDataSource(opts)
  const http = createHttpDataSource(opts?.http)
  if (!http) return mock
  if (opts?.fallbackToMock === false) return http
  return {
    booking: withFallbackDomain(http.booking, mock.booking),
    repair: withFallbackDomain(http.repair, mock.repair),
    overview: withFallbackDomain(http.overview, mock.overview),
  }
}

// ---------------------------------------------------------------------------
// 进程内单例:main.tsx 启动时 configureDataSource(...) 一次即可;
// 未配置时 getDataSource() 返回默认 Mock(纯静态兜底,不读仿真快照)。
// ---------------------------------------------------------------------------
let current: CampusDataSource | null = null

export function configureDataSource(opts?: DataSourceFactoryOptions): CampusDataSource {
  current = createDataSource(opts)
  return current
}

export function getDataSource(): CampusDataSource {
  if (!current) current = createDataSource()
  return current
}
