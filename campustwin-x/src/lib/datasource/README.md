# 数据源适配层(src/lib/datasource)

让「找会议室 / 报修 / 校园态势」三类能力在不改动 UI 与 handler 业务逻辑的前提下,
从本地 Mock 平滑切换到学校真实后端(预约系统 / 工单系统 / 能耗 API)。

## 结构

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 统一接口:`BookingDataSource` / `RepairDataSource` / `OverviewDataSource` / `CampusDataSource` |
| `mock.ts` | `MockDataSource`:取数自 `lib/rooms.ts`(rooms.json)与注入的仿真快照,行为与现状一致 |
| `http.ts` | `HttpDataSource` 骨架:baseUrl/token 配置、fetch 封装、超时与错误归一(`DataSourceError`) |
| `index.ts` | 门面:`createDataSource` / `configureDataSource` / `getDataSource`,HTTP 运行时失败自动回退 Mock |

## 快速开始(Mock,零配置)

```ts
import { getDataSource } from '../lib/datasource'

const rooms = await getDataSource().booking.listRooms()
```

未调用 `configureDataSource` 时,单例默认是纯 Mock(态势走静态排期兜底)。

## 启动时装配(建议加在 main.tsx,由接线方执行)

```ts
import { configureDataSource } from './lib/datasource'
import { useSimStore } from './store/simStore'

configureDataSource({
  // 让 Mock 态势读取仿真快照,与现状 overviewHandler 主路径行为一致
  getSimSnapshot: () => {
    const s = useSimStore.getState()
    return { buildingOccupancy: s.buildingOccupancy, buildingEnergy: s.buildingEnergy }
  },
  // 接真实后端时打开以下两行即可,其余代码零改动:
  // http: { baseUrl: 'https://api.example.edu.cn/campustwin', token: import.meta.env.VITE_DS_TOKEN },
  // fallbackToMock: true, // 默认 true:后端故障时降级 Mock,指挥台不中断
})
```

## 接入真实后端的步骤

1. **确认后端契约**:后端按 `http.ts` 顶部注释的约定暴露 REST 接口(字段形状复用
   `lib/agentTypes.ts` 的 `Room` / `Booking` / `Ticket` 与 `OverviewSnapshot`):
   - `GET  /rooms` → `{ rooms: Room[] }`
   - `POST /rooms/search` → `{ rooms: Room[] }`(body 为 `RoomQuery`,可服务端过滤)
   - `POST /bookings` → `Booking`(body 为 `CreateBookingInput`)
   - `POST /tickets` → `Ticket`(body 为 `CreateTicketInput`)
   - `GET  /overview/snapshot` → `OverviewSnapshot`(能耗/客流 API 聚合)
2. **配置装配**:在启动时装配处传入 `http: { baseUrl, token, timeoutMs? }`;
   token 建议走环境变量,不要硬编码进仓库。
3. **灰度策略**:`fallbackToMock` 保持 `true`,后端任意接口失败都会自动降级到 Mock
   并 `console.warn` 留痕;联调稳定后可显式设为 `false` 让错误直接暴露。
4. **差异适配**:若学校系统字段与本层契约不一致,只改 `http.ts` 的响应解析
   (加一层 `toRoom()` / `toTicket()` 映射),接口与上层代码不动。

## 建议的接线方式(handler 层由另一位工程师维护,以下为建议片段)

方案 A(推荐,显式注入):`dispatchIntent.ts` 的 `HandlerContext` 增加 `ds` 字段——

```ts
// dispatchIntent.ts
import type { CampusDataSource } from '../lib/datasource'
export interface HandlerContext {
  buildings: BakedBuilding[]
  campus: typeof useCampusStore
  ui: typeof useUIStore
  sim: typeof useSimStore
  ds: CampusDataSource // 新增:由 App 装配处注入 getDataSource()
}
```

```ts
// bookingHandler.ts:房源检索改走数据源(放宽逻辑保留在 handler)
const rooms = await ctx.ds.booking.listRooms()        // 替代 ensureRooms(ctx)
let candidates = await ctx.ds.booking.searchRooms(query)

// repairHandler.ts:工单创建改走数据源
const ticket = await ctx.ds.repair.createTicket({ roomId: room.id, deviceId: device, desc: intent.rawText })
// 注意:campus.createTicket 仍需调用(或改为 store 订阅数据源事件)以驱动报修面板 UI

// overviewHandler.ts:快照读取改走数据源
const snap = await ctx.ds.overview.getOverview()      // origin === 'sim' | 'static' | 'remote'
```

方案 B(零改动过渡):handler 不动签名,直接 `import { getDataSource } from '../../lib/datasource'`
在需要处取用;适合先在单个 handler 试点,再推广到方案 A。
