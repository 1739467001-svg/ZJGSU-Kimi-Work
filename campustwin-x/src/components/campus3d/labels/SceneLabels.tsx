// M2-D3 楼名标注:L0/L1 楼名牌,CanvasTexture Sprite(系统字体绘 canvas,断网可用,禁用 troika)
// 规则(手册 §3.7 + 任务书):位置 = 楼中心 + height + 8;同屏 ≤24(按相机距离取近);
// 相机 >400m 只显 L0,>800m 全隐;总开关 uiStore.labelsVisible
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import { useUIStore } from '../../../store/uiStore'

const MAX_LABELS = 24
/** 相机距离超过此值只显示 L0 */
const DIST_L0_ONLY = 400
/** 相机距离超过此值全部隐藏 */
const DIST_HIDE_ALL = 800
/** 名牌世界高度(米),宽度按文字宽高比展开;大小随 lod */
const LABEL_HEIGHT: Record<number, number> = { 0: 9, 1: 6 }

export interface SceneLabelsProps {
  buildings: BakedBuilding[]
}

interface LabelCandidate {
  id: string
  lod: number
  position: THREE.Vector3
}

interface LabelSkin {
  texture: THREE.CanvasTexture
  aspect: number
}

// 每楼一张 CanvasTexture,模块级缓存(楼数稳定,纹理常驻不重建)
// 导出供 BuildingSlice 房间/楼层标签复用(key 加前缀避免与楼 id 冲突)
const skinCache = new Map<string, LabelSkin>()

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** 白字深色底圆角名牌;2 倍超采样保证远景缩小时清晰 */
function createLabelSkin(name: string): LabelSkin {
  const fontSize = 44
  const padX = 34
  const padY = 18
  const font = `600 ${fontSize}px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`

  const measure = document.createElement('canvas').getContext('2d')
  if (!measure) throw new Error('canvas 2d unavailable')
  measure.font = font
  const textW = Math.ceil(measure.measureText(name).width)

  const w = textW + padX * 2
  const h = fontSize + padY * 2
  const ss = 2 // supersample
  const canvas = document.createElement('canvas')
  canvas.width = w * ss
  canvas.height = h * ss
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.scale(ss, ss)

  roundRectPath(ctx, 1.5, 1.5, w - 3, h - 3, 14)
  ctx.fillStyle = 'rgba(22, 27, 33, 0.88)' // 面板 #161b21
  ctx.fill()
  ctx.strokeStyle = '#2a323b' // 描边
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f2f5f7' // 白字
  ctx.fillText(name, w / 2, h / 2 + 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: w / h }
}

export function getLabelSkin(id: string, name: string): LabelSkin {
  let skin = skinCache.get(id)
  if (!skin) {
    skin = createLabelSkin(name)
    skinCache.set(id, skin)
  }
  return skin
}

const tmpVec = new THREE.Vector3()

export default function SceneLabels({ buildings }: SceneLabelsProps) {
  const labelsVisible = useUIStore((s) => s.labelsVisible)
  const throttleAcc = useRef(0)
  const [visibleIds, setVisibleIds] = useState<string[]>([])

  // L0/L1 实名楼为候选;名牌锚点 = 楼中心 + 楼顶 + 8m
  const candidates = useMemo<LabelCandidate[]>(
    () =>
      buildings
        .filter((b): b is BakedBuilding & { name: string } => b.name != null && b.lod <= 1)
        .map((b) => ({
          id: b.id,
          lod: b.lod,
          position: new THREE.Vector3(b.center[0], b.height + 8, b.center[1]),
        })),
    [buildings],
  )

  const idToCandidate = useMemo(() => {
    const m = new Map<string, LabelCandidate>()
    for (const c of candidates) m.set(c.id, c)
    return m
  }, [candidates])

  // 距离门控 + 限量:useFrame 节流 4Hz 重算(动画一律 useFrame,禁 setInterval)
  useFrame((state, delta) => {
    throttleAcc.current += delta
    if (throttleAcc.current < 0.25) return
    throttleAcc.current = 0

    if (!useUIStore.getState().labelsVisible) {
      if (visibleIds.length) setVisibleIds([])
      return
    }
    const cam = state.camera.position
    const scored: { id: string; d: number }[] = []
    for (const c of candidates) {
      const d = tmpVec.copy(c.position).distanceTo(cam)
      if (d > DIST_HIDE_ALL) continue // >800m 全隐
      if (d > DIST_L0_ONLY && c.lod !== 0) continue // >400m 只显 L0
      scored.push({ id: c.id, d })
    }
    scored.sort((a, b) => a.d - b.d)
    const next = scored.slice(0, MAX_LABELS).map((s) => s.id)
    if (next.length !== visibleIds.length || next.some((id, i) => id !== visibleIds[i])) {
      setVisibleIds(next)
    }
  })

  const visibleLabels = useMemo(
    () =>
      visibleIds
        .map((id) => idToCandidate.get(id))
        .filter((c): c is LabelCandidate => c != null)
        .map((c) => {
          const b = buildings.find((x) => x.id === c.id)
          return b && b.name != null ? { candidate: c, skin: getLabelSkin(c.id, b.name) } : null
        })
        .filter((x): x is { candidate: LabelCandidate; skin: LabelSkin } => x != null),
    [visibleIds, idToCandidate, buildings],
  )

  if (!labelsVisible) return null

  return (
    <group>
      {visibleLabels.map(({ candidate, skin }) => {
        const h = LABEL_HEIGHT[candidate.lod] ?? 6
        return (
          <sprite
            key={candidate.id}
            position={candidate.position}
            scale={[h * skin.aspect, h, 1]}
            renderOrder={10}
          >
            <spriteMaterial map={skin.texture} transparent depthWrite={false} toneMapped={false} />
          </sprite>
        )
      })}
    </group>
  )
}
