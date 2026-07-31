# CampusTwin React 版 Demo 产品与技术规格 v2.0

> 定位：把分散在多个校园系统里的空间、设备、工单、态势能力，收敛成一个「一句话调度校园」的 3D 数字孪生服务台。  
> 目标：面向初赛做一个可运行、可体验、可路演、可录屏传播的前端 Demo。  
> 技术路线：React + TypeScript + 3D 数字孪生 + 本地数据 + 规则 Agent + 可选大模型增强。

---

## 1. 产品一句话

**CampusTwin 是一个用自然语言驱动的校园空间操作系统。**

它不是单纯的校园地图，也不是普通预约系统，而是把校园里的高频公共服务压缩到一句话入口：

- 找空教室
- 预约会议室
- 设备报修
- 校园导航
- 能耗、人流、占用态势
- 管理者异常定位与调度建议

过去是：

```txt
人找系统：登录多个系统 -> 查资源 -> 填表 -> 等流程 -> 再看结果
```

现在是：

```txt
一句话调度系统：说出需求 -> Agent 理解 -> 3D 高亮 -> 面板操作 -> 状态联动
```

核心价值：

```txt
N 个系统 -> 1 个入口
复杂流程 -> 一句话
静态表格 -> 3D 态势
分散数据 -> 统一空间视图
```

---

## 2. 为什么改成 React 版

原 PRD 中的 Vue 3 技术栈可行，但这个项目更适合 React 生态来做比赛 Demo。

原因不是 Vue 做不了，而是本项目的核心难点集中在：

- 3D 场景与 UI 面板实时联动
- Agent 执行流、聊天流、任务状态共享
- 复杂交互动画和路演高光
- 组件化服务台和右栏上下文切换
- 快速做出有质感的界面

React 版推荐技术栈：

```txt
Vite
React
TypeScript
Tailwind CSS
Zustand
react-three-fiber
@react-three/drei
ECharts 或 Recharts
Framer Motion
Lucide React
本地 Mock 数据 / 静态 JSON
规则 Agent + 可选 LLM 接口
```

技术取舍：

- 用 `react-three-fiber` 管理 Three.js 场景，降低 3D 与 React 状态联动成本。
- 用 `Zustand` 管理全局状态，比重型状态框架更适合 Demo。
- 用 `Framer Motion` 做 Agent 步骤、面板切换、候选高亮等动效。
- 用 `ECharts` 做管理态势图表，适合能耗、人流、排行类展示。
- 用规则 Agent 保证断网可演示，用可选 LLM 提升自然语言体验。

---

## 3. 产品内核

CampusTwin 的真正亮点不是“AI 聊天框”，也不是“3D 地图”，而是：

**把校园业务逻辑整合进一句话，再把执行过程落到一张 3D 校园孪生图上。**

用户说：

```txt
帮我找一个现在空着、有投影、能坐 8 个人的会议室
```

系统执行：

```txt
识别意图 book_room
-> 提取时间、人数、设备、空间类型
-> 查询本地校园空间数据
-> 过滤可用房间
-> 3D 高亮候选
-> 右栏生成候选列表
-> 用户确认
-> 生成预约
-> 房间状态变为占用
-> 对话区回执
```

这就是 Demo 的主心骨。

---

## 4. 初赛 Demo 总目标

本次只做一个打开链接即可体验的全前端 Demo。

必须证明三件事：

1. **用户一句话能办事**
   - 预约会议室
   - 找空教室
   - 报修设备

2. **管理者一屏能看态势**
   - 占用率
   - 能耗
   - 人流
   - 异常定位

3. **评审能 3 秒看懂社会价值**
   - N 系统收敛为 1 个入口
   - 10 秒级办事
   - 可复制到社区、园区、医院、政务大厅
   - 对新生、访客、无障碍人群更友好

---

## 5. 非目标

为保证初赛 Demo 可控，本次不做：

- 不做真实后端
- 不做真实账号体系
- 不做真实审批流
- 不做在线数据库写入
- 不接真实 IoT 设备
- 不做完整全校高精度建模
- 不做复杂多智能体框架
- 不做移动端深度适配
- 不做复赛级真实可预约闭环

本次 Demo 的策略是：

```txt
前端真实可交互 + 数据本地可信 + 核心链路闭环 + 视觉表达强
```

---

## 6. 信息架构

界面采用三栏结构，但表达方式比原版更聚焦。

```txt
顶部品牌栏
CampusTwin | 一句话调度校园空间 | 演示数据 | 当前角色

左栏：一句话指挥台
- 自然语言输入
- Agent 执行步骤
- 当前任务时间线
- 历史指令

中栏：3D 校园孪生画布
- 校园楼宇
- 房间状态
- 高亮候选
- 热力层
- 异常定位
- 运镜聚焦

右栏：上下文服务台
- 找空间/预约面板
- 报修工单面板
- 管理态势面板
- 导航提示面板
```

三栏不是简单摆放，而是一个完整任务流：

```txt
左栏发起任务 -> 中栏显示空间结果 -> 右栏完成操作
```

---

## 7. 三条核心演示链路

### 7.1 链路一：一句话找空间 / 预约会议室

演示语句：

```txt
帮我找一个现在空着、有投影、能坐 8 个人的会议室
```

流程：

```txt
用户输入
-> 调度 Agent 判断为 book_room
-> 预约 Agent 提取 slots
-> 数据层筛选房间
-> 3D 高亮候选房间
-> 右栏展示候选列表
-> 用户选择并确认
-> 生成 Booking
-> 房间状态变为 busy
-> 对话区返回预约凭证
```

验收：

- 能识别预约/找空教室需求
- 候选结果与 schedule 一致
- 3D 能高亮候选
- 右栏可确认预约
- 预约后状态联动更新

### 7.2 链路二：一句话设备报修

演示语句：

```txt
三号楼 302 投影坏了
```

流程：

```txt
用户输入
-> 调度 Agent 判断为 repair
-> 报修 Agent 提取楼宇、房间、设备
-> 3D 定位房间并标红
-> 右栏自动填充报修表单
-> 用户提交
-> 生成 Ticket
-> 工单状态可推进：待受理 -> 处理中 -> 已完成
-> 对话区返回工单编号
```

验收：

- 能解析楼宇、房间、设备
- 能定位到对应空间
- 能生成报修工单
- 工单状态可见且可推进
- 管理态势可显示异常项

### 7.3 链路三：一句话管理态势

演示语句：

```txt
看一下现在全校哪里最紧张
```

流程：

```txt
用户输入
-> 调度 Agent 判断为 admin_overview
-> 态势 Agent 汇总占用率、能耗、人流
-> 右栏切换到管理态势
-> 中栏开启热力层
-> 异常楼宇高亮
-> 给出调度建议
```

验收：

- 有 KPI 卡片
- 有图表
- 有 3D 热力或异常高亮
- 能点击异常项定位楼宇
- 能给出至少一条调度建议

---

## 8. P0 功能范围

P0 只保留最能证明价值的内容。

### P0-1 三栏主界面

- 顶部品牌栏
- 左侧 Agent 指挥台
- 中间 3D 校园
- 右侧上下文服务台
- 桌面优先，移动端可降级

### P0-2 本地校园数据层

包括：

- Building
- Floor
- Room
- Device
- Booking
- Ticket
- Energy
- Traffic
- User

要求：

- 全部集中在 Zustand store
- 3D、右栏、Agent、图表共用同一份数据
- 修改状态后全界面联动

### P0-3 3D 校园孪生

- 3 至 5 栋核心楼宇
- 楼宇按真实或近似真实相对位置摆放
- 道路、绿化、广场等低成本环境元素
- 支持旋转、缩放、平移
- 支持点击楼宇/房间
- 支持状态颜色
- 支持 Agent 高亮

状态颜色：

```txt
free      绿色
busy      灰色
repair    红色
matched   蓝色
selected  金色或品牌强调色
hot       橙红色热力
```

### P0-4 规则 Agent

内部实现不做复杂智能体框架，而是轻量任务管线：

```txt
parseIntent(text)
-> planTask(intent)
-> runDomainHandler(task)
-> updateUIEffects(result)
-> mutateStore(result)
```

对外展示为：

```txt
调度 Agent
-> 预约 Agent / 报修 Agent / 导航 Agent / 态势 Agent
```

必须覆盖意图：

- `book_room`
- `find_free_classroom`
- `repair`
- `navigate`
- `admin_overview`
- `unknown`

### P0-5 预约 / 找空教室闭环

- 解析时间、人数、设备、空间类型
- 过滤候选房间
- 高亮候选
- 右栏展示候选
- 选择并确认
- 生成预约
- 更新房间状态

### P0-6 报修闭环

- 解析楼宇、房间、设备
- 定位空间
- 自动填表
- 提交工单
- 状态推进
- 异常进入管理视图

### P0-7 管理态势

- KPI：占用率、今日能耗、实时人流、异常工单
- 图表：占用率排行、能耗趋势、人流分布
- 3D：热力层或异常高亮
- 联动：点击图表/异常项定位楼宇

### P0-8 社会价值表达

界面中必须显式出现：

- N 系统 -> 1 入口
- 一句话 10 秒办事
- 可复制到社区 / 园区 / 医院 / 政务大厅
- 新生 / 访客 / 无障碍友好

注意：这些不是单独做成宣传页，而是融入产品界面，例如顶部指标、左栏标签、右栏洞察卡。

---

## 9. P1 功能范围

时间允许再做：

- 3D 寻路路径动画
- 楼层/房间更细下钻
- 无障碍路线偏好
- 新生模式
- 会议室推荐理由
- 管理者可执行调度卡片
- 高光录屏模式
- 移动端适配优化
- 接入真实 LLM API

---

## 10. 数据模型

```ts
export type RoomType = 'meeting' | 'classroom' | 'venue' | 'lab'
export type RoomStatus = 'free' | 'busy' | 'repair'
export type DeviceType = 'projector' | 'ac' | 'light' | 'mic' | 'screen'
export type DeviceStatus = 'ok' | 'fault'
export type TicketStatus = 'new' | 'doing' | 'done'

export interface Building {
  id: string
  name: string
  alias?: string[]
  position: [number, number, number]
  size: [number, number, number]
  floors: Floor[]
  tags?: string[]
}

export interface Floor {
  id: string
  buildingId: string
  level: number
  rooms: Room[]
}

export interface Room {
  id: string
  buildingId: string
  floorId: string
  name: string
  type: RoomType
  capacity: number
  equipment: DeviceType[]
  status: RoomStatus
  schedule: ScheduleItem[]
  positionHint?: [number, number, number]
}

export interface ScheduleItem {
  start: string
  end: string
  by: string
  title?: string
}

export interface Device {
  id: string
  roomId: string
  type: DeviceType
  status: DeviceStatus
}

export interface Booking {
  id: string
  roomId: string
  user: string
  start: string
  end: string
  status: 'ok' | 'cancelled'
  createdAt: string
}

export interface Ticket {
  id: string
  deviceId?: string
  roomId: string
  desc: string
  status: TicketStatus
  assignee: string
  createdAt: string
}

export interface EnergyPoint {
  buildingId: string
  kwh: number
  ts: string
}

export interface TrafficPoint {
  zoneId: string
  count: number
  ts: string
}

export interface User {
  id: string
  role: 'student' | 'teacher' | 'admin' | 'visitor'
  name: string
}
```

---

## 11. Agent 数据结构

```ts
export type IntentName =
  | 'book_room'
  | 'find_free_classroom'
  | 'repair'
  | 'navigate'
  | 'admin_overview'
  | 'unknown'

export type AgentName =
  | '调度Agent'
  | '预约Agent'
  | '报修Agent'
  | '导航Agent'
  | '态势Agent'

export interface Intent {
  intent: IntentName
  slots: {
    time?: string
    start?: string
    end?: string
    capacity?: number
    equipment?: string[]
    building?: string
    room?: string
    device?: string
    target?: string
  }
  agent: AgentName
  confidence: number
  rawText: string
}

export interface AgentStep {
  id: string
  agent: AgentName
  title: string
  detail: string
  status: 'waiting' | 'running' | 'done' | 'error'
}

export interface TaskResult {
  type: 'booking_candidates' | 'booking_done' | 'ticket_created' | 'overview' | 'navigation' | 'unknown'
  message: string
  roomIds?: string[]
  buildingIds?: string[]
  bookingId?: string
  ticketId?: string
}
```

---

## 12. 前端模块设计

建议目录结构：

```txt
src/
  app/
    App.tsx
    providers.tsx
  components/
    layout/
      AppShell.tsx
      TopBar.tsx
      CommandPanel.tsx
      ServiceDesk.tsx
    agent/
      ChatInput.tsx
      MessageList.tsx
      AgentTimeline.tsx
      AgentStepCard.tsx
    campus3d/
      CampusCanvas.tsx
      BuildingMesh.tsx
      BuildingSlice.tsx
      RoomMarker.tsx
      HeatLayer.tsx
      FlowLines.tsx
      StatusLightBand.tsx
      CameraDirector.tsx
      CommandTableEffects.tsx
      SceneLabels.tsx
    service/
      BookingPanel.tsx
      RepairPanel.tsx
      OverviewPanel.tsx
      NavigationPanel.tsx
    charts/
      OccupancyChart.tsx
      EnergyTrendChart.tsx
      TrafficChart.tsx
    ui/
      Button.tsx
      Tooltip.tsx
      Tabs.tsx
      Badge.tsx
  data/
    seedCampus.ts
    demoScenarios.ts
  store/
    campusStore.ts
    uiStore.ts
  agent/
    parseIntent.ts
    dispatchIntent.ts
    handlers/
      bookingHandler.ts
      repairHandler.ts
      overviewHandler.ts
      navigationHandler.ts
  lib/
    time.ts
    roomSearch.ts
    ids.ts
  styles/
    globals.css
```

---

## 13. 状态管理设计

使用 Zustand。

核心 store：

```ts
interface CampusState {
  buildings: Building[]
  devices: Device[]
  bookings: Booking[]
  tickets: Ticket[]
  energy: EnergyPoint[]
  traffic: TrafficPoint[]
  currentIntent?: Intent
  agentSteps: AgentStep[]
  selectedRoomId?: string
  selectedBuildingId?: string
  highlightedRoomIds: string[]
  activePanel: 'booking' | 'repair' | 'overview' | 'navigation' | 'empty'
  sceneMode: 'idle' | 'searching' | 'booking' | 'repair' | 'overview' | 'navigation'
  heatMode: 'none' | 'energy' | 'traffic' | 'occupancy'
  cameraFocus?: {
    type: 'campus' | 'building' | 'room' | 'route'
    id?: string
  }
  slicedBuildingId?: string

  submitCommand: (text: string) => Promise<void>
  highlightRooms: (ids: string[]) => void
  selectRoom: (id: string) => void
  createBooking: (input: CreateBookingInput) => Booking
  createTicket: (input: CreateTicketInput) => Ticket
  advanceTicket: (id: string) => void
  setSceneMode: (mode: CampusState['sceneMode']) => void
  setHeatMode: (mode: CampusState['heatMode']) => void
  focusCamera: (focus: CampusState['cameraFocus']) => void
}
```

原则：

- 3D 不单独维护业务状态，只读取 store。
- 右栏操作必须回写 store。
- Agent 不直接操作 DOM，只产生任务结果和状态变化。
- 所有 Demo 场景可以通过 `demoScenarios` 一键触发。

---

## 14. 中栏 3D 数字沙盘视觉方案

中间区域不是普通 3D 地图，而是比赛现场的主舞台。

视觉定位：

```txt
Campus Command Table
校园指挥沙盘
```

它要让评审第一眼感到：

```txt
这个系统不是在展示校园，而是在实时调度校园。
```

设计原则：

- 不追求真实建模的复杂度，追求数字孪生的“可感知、可操作、可调度”。
- 不把楼宇做成普通盒子地图，要通过光带、剖层、热力、流线、运镜制造记忆点。
- 不让用户在 3D 里迷路，关键任务由 Agent 自动运镜聚焦。
- 不让 3D 成为背景装饰，所有视觉变化都要来自业务状态。

### 14.1 场景风格

关键词：

```txt
数字沙盘
低多边形建筑
半透明楼体
楼层切片
状态光带
运镜聚焦
数据热力
任务命中高亮
校园正在运行
```

视觉基调：

- 中栏采用深色指挥中心风格，形成和左右工作台的对比。
- 楼宇使用半透明玻璃材质或磨砂数据块材质。
- 地面是深色沙盘底座，带细网格、道路线和轻微发光边界。
- 颜色不做花哨渐变，状态色必须清晰：绿、灰、红、蓝、橙红。
- 整体感觉要精密、克制、有调度感，不做泛 AI 风的紫色光污染。

### 14.2 首屏唤醒

打开页面时，中间画面应直接形成视觉抓力。

首屏状态：

```txt
低角度俯视校园沙盘
楼宇从沙盘上轻微抬起
道路有细微流动线
楼顶状态灯带缓慢呼吸
少量建筑标签悬浮
能耗 / 人流有极弱热力浮层
```

目标效果：

```txt
评委不用听解释，也能感觉这是一张正在运行的校园态势图。
```

不建议：

- 不要做静态俯视平面图。
- 不要一打开就是空白加载或普通旋转模型。
- 不要把复杂说明文字压在 3D 上。

### 14.3 四个 Wow 瞬间

#### Wow 1：一句话触发运镜

输入：

```txt
帮我找一个现在空着、有投影、能坐 8 个人的会议室
```

中栏动作：

```txt
校园整体轻微降亮
Agent 扫描光从左向右掠过沙盘
候选楼宇依次点亮
镜头推向命中区域
候选房间蓝色描边或浮出
右栏候选列表同步滑入
```

这个瞬间要传达：

```txt
系统听懂了，并且真的在校园空间里找到了答案。
```

#### Wow 2：楼宇剖层 / 房间下钻

点击候选楼宇或候选房间时：

```txt
楼体轻微抬升
非目标楼层透明度降低
目标楼层像切片一样展开
目标房间发光描边
房间信息以轻量悬浮标签出现
```

这个设计比普通弹窗更有数字孪生感，也更适合录屏。

#### Wow 3：报修异常脉冲

输入：

```txt
三号楼 302 投影坏了
```

中栏动作：

```txt
镜头快速定位到对应楼宇
目标房间红色脉冲
设备故障点出现小型告警标记
楼宇状态灯带局部变红
右栏报修表单自动填充
```

这个瞬间要让评委看到：

```txt
报修不是填表，而是空间定位 + 工单生成。
```

#### Wow 4：管理态势热力爆发

输入：

```txt
看一下现在全校哪里最紧张
```

中栏动作：

```txt
切换 overview 模式
楼宇按占用率升高或变色
道路出现人流线
能耗以楼体侧面光带显示
异常楼宇橙红色脉冲
镜头自动聚焦最紧张区域
```

这个瞬间要传达：

```txt
这不是预约工具，而是校园运行态势系统。
```

### 14.4 场景元素

- 核心教学区楼宇
- 校园主路
- 广场
- 绿化块
- 房间/楼层提示
- 状态光带
- 命中高亮
- 热力层
- 人流线
- 能耗柱或楼体侧边光带
- Agent 扫描线
- 楼宇剖层切片
- 悬浮标签
- 任务轨迹线

元素优先级：

```txt
P0：楼宇、道路、状态色、候选高亮、镜头聚焦、热力层
P0+：楼宇剖层、房间浮出、扫描光、状态灯带
P1：路径动画、人流粒子、能耗柱、录屏高光模式
```

### 14.5 交互

- 鼠标拖拽旋转
- 滚轮缩放
- 点击楼宇选中
- 点击候选房间定位
- Agent 执行时自动运镜
- 管理异常点击时自动聚焦
- 右栏点击候选时，中栏必须同步聚焦
- Agent 扫描期间，用户仍可旋转但镜头会柔和回到任务目标
- 楼宇下钻后提供返回校园总览的控件

交互原则：

```txt
用户可以探索，但关键路演动作由系统导演。
```

### 14.6 技术实现建议

使用：

```txt
react-three-fiber
@react-three/drei
Three.js InstancedMesh
EffectComposer
Bloom
Outline
Line / CatmullRomCurve3
Html / Text
自定义 CameraDirector
```

实现方式：

- 楼宇主体用 box geometry 组合，不做高精模型。
- 半透明材质叠加边线，形成数据建筑感。
- 房间可用小块体或楼层切片表达，不必真实还原每个房间。
- `highlightedRoomIds` 驱动蓝色候选高亮。
- `sceneMode` 决定场景模式：搜索、预约、报修、态势、导航。
- `cameraFocus` 驱动镜头自动转场。
- `slicedBuildingId` 控制楼宇剖层展开。
- 热力层用半透明 plane 或颜色插值，不一开始做复杂 shader。
- 流线用曲线和少量移动点表达，控制数量保证性能。

镜头设计：

```txt
idle       低角度总览，缓慢呼吸
searching 先看全校，再推向候选楼宇
booking   聚焦候选房间，略微俯视
repair    快速定位并停在目标楼层
overview  拉高视角，显示热力和全局态势
```

### 14.7 视觉验收

3D 中栏必须满足：

- 首屏 3 秒内形成“数字沙盘”观感。
- 输入示例指令后，3D 必须有明显响应。
- 候选空间不是只在列表里出现，必须在沙盘中可见。
- 报修异常必须有红色空间定位。
- 管理态势必须有热力或异常聚焦。
- 至少一个楼宇有剖层或房间下钻效果。
- 30 秒高光录屏中，中栏必须承担主要视觉冲击。

### 14.8 性能目标

- 桌面端 30 FPS 以上
- 首屏 3 秒内可交互
- 低端机器仍能展示基本楼宇和高亮
- 后处理效果可降级关闭
- 粒子、流线、标签数量必须可控
- 移动端可降级为 2.5D 视图或简化沙盘

---

## 15. UI 视觉方向

整体感觉：

```txt
专业
克制
清晰
有比赛作品感
不像后台模板
不像普通聊天应用
中心画布有强烈的视觉记忆点
```

核心审美方向：

```txt
冷静工作台 + 精密数字沙盘
```

布局建议：

- 中栏 3D 使用深色指挥沙盘风，是第一视觉重心。
- 左右栏使用浅色或半浅色工作台风格，为中栏提供对比和操作承接。
- 品牌色可采用偏理性的蓝绿系，辅以橙红异常色和金色选中色。
- 不使用整页单一蓝紫渐变，不做通用 AI 产品感。
- Agent 步骤卡要像任务调度系统，不要像普通消息气泡堆叠。
- 右栏面板要强调“可操作”，不是只展示说明。
- 所有视觉动效都要和业务状态有关，避免无意义装饰。

重要视觉瞬间：

```txt
首屏：校园沙盘已经在运行
输入：Agent 扫描光掠过校园
搜索：候选楼宇依次点亮
下钻：楼宇剖层，目标房间浮出
确认：房间状态切换并生成凭证
报修：目标房间红色脉冲
态势：热力层展开，异常楼宇聚焦
```

这就是最适合录屏的 20 至 30 秒高光。

UI 和 3D 的关系：

```txt
左栏负责发号施令
中栏负责制造看见和相信
右栏负责完成操作和留凭证
```

---

## 16. 真实锚点策略

为了提升可信度，至少做一个真实锚点。

优先级最高的是：

```txt
核心教学区楼名 + 相对位置 + 部分真实课表/占用样例
```

可实现方式：

- 楼宇名称使用真实校园楼名或接近真实的教学区名称。
- 楼宇相对位置按公开地图或手工抽象布局。
- 课表/会议室占用使用静态数据嵌入前端。
- 在界面标注“演示数据，结构可替换为真实系统数据”。

不要在初赛阶段追求全量真实数据。只需要让一条链路可信：

```txt
找空教室 / 预约会议室结果与静态课表一致
```

---

## 17. 比赛表达

### 17.1 评审看到的第一层

```txt
这是一个校园服务统一入口。
学生不用找系统，说一句话就能办事。
管理者不用看表格，一屏就能看态势。
```

### 17.2 评审看到的第二层

```txt
它不是只适用于校园。
同样可以复制到社区、园区、医院、政务大厅。
因为这些场景都有空间、资源、工单、服务、调度。
```

### 17.3 评审看到的第三层

```txt
它对新生、访客、无障碍人群更友好。
不要求用户理解复杂组织结构和系统菜单。
自然语言就是入口。
```

---

## 18. 演示脚本

### 18.1 开场 10 秒

话术：

```txt
校园里很多服务分散在不同系统里：预约、报修、找教室、导航、管理态势。
CampusTwin 想做的是把 N 个系统收敛成 1 个自然语言入口。
```

动作：

- 展示三栏界面
- 指向左侧一句话输入
- 指向中间正在运行的 3D 校园指挥沙盘
- 指向右侧服务台
- 让评审先看到楼宇光带、道路流线和少量热力浮层

### 18.2 主演示 30 秒

输入：

```txt
帮我找一个现在空着、有投影、能坐 8 个人的会议室
```

展示：

- Agent 步骤点亮
- 中栏出现扫描光，校园整体进入 searching 模式
- 镜头推向候选楼宇
- 候选房间蓝色描边或浮出
- 点击候选后楼宇剖层，目标房间高亮
- 右栏候选列表同步出现
- 点击确认
- 房间状态变为占用
- 生成预约凭证

### 18.3 第二演示 20 秒

输入：

```txt
三号楼 302 投影坏了
```

展示：

- 镜头自动定位到对应楼宇
- 楼宇剖层或目标楼层突出
- 房间红色脉冲
- 设备故障点出现告警标记
- 表单自动填充
- 生成工单
- 状态推进

### 18.4 管理演示 20 秒

输入：

```txt
看一下现在全校哪里最紧张
```

展示：

- KPI
- 图表
- 3D 切换 overview 模式
- 热力层展开
- 人流线或能耗光带出现
- 异常楼宇橙红色脉冲
- 镜头聚焦最紧张区域
- 调度建议

### 18.5 收束 10 秒

话术：

```txt
这套能力不只服务校园，也可以迁移到社区、园区、医院和政务大厅。
本质上，它把空间资源、公共服务和管理调度统一到一句话入口。
```

---

## 19. 开发顺序

建议按以下顺序实现，避免一开始陷入复杂 3D 或 Agent 架构。

### 阶段 1：项目骨架

- Vite React 初始化
- Tailwind 配置
- 三栏布局
- Zustand store
- 静态校园数据

验收：

- `npm run dev` 可启动
- 三栏可见
- 数据可在页面展示

### 阶段 2：预约主链路

- 规则 Intent Parser
- Agent 步骤展示
- 房间筛选
- 候选列表
- 预约确认
- 状态更新

验收：

- 不依赖 3D 也能先跑通业务闭环

### 阶段 3：3D 数字沙盘接入

- CampusCanvas
- BuildingMesh
- StatusLightBand
- CameraDirector
- 房间/楼宇状态色
- 点击选中
- 高亮候选
- 镜头聚焦
- searching / booking / repair / overview 场景模式
- 首屏数字沙盘观感

验收：

- Agent 能驱动 3D 高亮
- 右栏操作能反向更新 3D
- 示例指令触发后，中栏有明显运镜和高亮响应

### 阶段 3.5：沙盘 Wow 效果

- Agent 扫描光
- 楼宇剖层
- 房间浮出或描边
- 报修红色脉冲
- 管理态势热力层

验收：

- 至少完成两个 Wow 瞬间：一句话触发运镜、楼宇剖层或态势热力

### 阶段 4：报修链路

- 报修意图识别
- 房间定位
- 工单表单
- 工单状态推进
- 红色异常高亮

验收：

- 设备报修完整闭环

### 阶段 5：管理态势

- KPI
- ECharts 图表
- 热力模式
- 异常项定位
- 调度建议

验收：

- 管理者一屏可读

### 阶段 6：视觉和路演打磨

- 动效
- 运镜
- 高光模式
- 首屏唤醒
- 30 秒视觉脚本
- 社会价值表达
- 录屏脚本

验收：

- 30 秒高光片段可独立播放，且中栏 3D 是主要视觉冲击点

---

## 20. 验收标准

全部满足才算初赛 Demo 完成。

- [ ] 部署链接打开即用
- [ ] 无需登录
- [ ] 三栏界面稳定
- [ ] 3D 场景可交互
- [ ] 首屏 3 秒内形成“校园指挥沙盘”视觉记忆点
- [ ] 一句话预约/找空教室闭环跑通
- [ ] 预约/找空教室时，3D 有扫描、运镜、候选高亮
- [ ] 设备报修闭环跑通
- [ ] 报修时，目标房间有红色空间定位或脉冲
- [ ] 管理态势可展示
- [ ] 管理态势有热力层、流线、光带或异常楼宇聚焦
- [ ] Agent 步骤可视化
- [ ] 3D 与右栏状态联动
- [ ] 至少一个楼宇支持剖层或房间下钻效果
- [ ] 断网下 P0 可演示
- [ ] 桌面端无明显卡顿
- [ ] 至少一条真实锚点链路
- [ ] 社会价值表达在界面可见
- [ ] 可录制 30 秒高光片段，单独观看也能理解产品亮点

---

## 21. 推荐首页状态

不要做营销落地页。打开后直接进入产品主界面。

默认状态：

- 3D 校园指挥沙盘在中间可见，并处于轻微运行状态
- 楼宇状态灯带缓慢呼吸
- 道路线有细微流动
- 少量人流 / 能耗热力以低强度浮层呈现
- 左侧输入框处于可输入状态
- 左侧显示 3 个示例指令
- 右侧显示“校园服务总览”
- 顶部显示核心价值标签

首页第一眼目标：

```txt
不需要用户点击，评审也能看出这不是普通后台，而是一张可被一句话调度的校园数字沙盘。
```

示例指令：

```txt
帮我找一个现在空着、有投影、能坐 8 个人的会议室
三号楼 302 投影坏了
看一下现在全校哪里最紧张
```

---

## 22. 一句话总结

CampusTwin v2.0 的产品策略是：

**不平均展示一堆校园功能，而是用一句话入口串起空间查询、预约执行、设备报修和管理态势，让评审看到一个可复制的公共服务新范式。**

工程策略是：

**用 React 生态快速做出高质量交互，用规则 Agent 保证稳定，用 3D 指挥沙盘制造第一眼记忆点，用本地数据跑通闭环。**
