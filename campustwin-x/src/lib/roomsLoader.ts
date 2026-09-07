// rooms 懒加载的 store 桥接:ensureRoomsLoaded()(lib/rooms,纯 fetch 缓存)
// 拉到的数据在这里统一回写 campusStore,供 App 启动深链 / 面板挂载 / AI 指令链路共用。
// 幂等:多次调用共享同一 Promise,且仅在 store 为空时回写,不覆盖运行期数据。
import type { Room } from './agentTypes'
import { ensureRoomsLoaded } from './rooms'
import { useCampusStore } from '../store/campusStore'

/** 确保 rooms 已加载并写入 campusStore;返回 rooms(可能为空数组,如 fetch 失败) */
export function requestRooms(): Promise<Room[]> {
  const existing = useCampusStore.getState().rooms
  if (existing.length) return Promise.resolve(existing)
  return ensureRoomsLoaded().then((rooms) => {
    if (rooms.length && useCampusStore.getState().rooms.length === 0) {
      useCampusStore.getState().setRooms(rooms)
    }
    return rooms
  })
}
