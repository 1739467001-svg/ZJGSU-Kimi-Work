// Agent 引擎入口:createCommandHandler(deps) → CommandHandler
// 供 campusStore.registerCommandHandler 注入,UI 只调 submitCommand
import type { TaskResult } from '../lib/agentTypes'
import type { BakedBuilding } from '../lib/campusData'
import { useCampusStore } from '../store/campusStore'
import { useUIStore } from '../store/uiStore'
import { useSimStore } from '../store/simStore'
import { parseIntent } from './parseIntent'
import { dispatchIntent, type HandlerContext } from './dispatchIntent'

export { parseIntent } from './parseIntent'
export { dispatchIntent } from './dispatchIntent'
export type { HandlerContext, HandlerOutput, IntentHandler } from './dispatchIntent'

export type CommandHandler = (text: string) => Promise<TaskResult>

export interface CommandHandlerDeps {
  /** 兜底楼宇数据;运行期优先使用 campusStore 中的实时数据 */
  buildings: BakedBuilding[]
  stores: {
    campus: typeof useCampusStore
    ui: typeof useUIStore
    sim: typeof useSimStore
  }
}

export function createCommandHandler(deps: CommandHandlerDeps): CommandHandler {
  const { campus, ui, sim } = deps.stores
  return async (text: string) => {
    const live = campus.getState().buildings
    const buildings = live.length ? live : deps.buildings
    const intent = parseIntent(text, buildings)
    const ctx: HandlerContext = { buildings, campus, ui, sim }
    return dispatchIntent(intent, ctx)
  }
}
