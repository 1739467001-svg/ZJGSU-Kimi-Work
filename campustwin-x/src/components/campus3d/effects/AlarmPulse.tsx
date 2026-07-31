import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import type { Room } from '../../../lib/agentTypes'
import { useCampusStore } from '../../../store/campusStore'
import { roomWorldPosition } from './BuildingSlice'

const ALARM_COLOR = '#ff3b30'

/** 程序化告警三角贴图(断网红线:不引用任何外部资源) */
function makeWarningTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128)
    // 三角
    ctx.beginPath()
    ctx.moveTo(64, 10)
    ctx.lineTo(120, 112)
    ctx.lineTo(8, 112)
    ctx.closePath()
    ctx.fillStyle = ALARM_COLOR
    ctx.fill()
    ctx.lineWidth = 6
    ctx.strokeStyle = '#ffd9d6'
    ctx.stroke()
    // 叹号
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(58, 42, 12, 38)
    ctx.beginPath()
    ctx.arc(64, 96, 7, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface Props {
  buildings: BakedBuilding[]
  /** 缺省读 campusStore.rooms */
  rooms?: Room[]
}

/**
 * 报修/应急告警:campusStore.alarmRoomId / alarmBuildingId 处
 * 红色呼吸脉冲(emissive sin(t×4))+ 告警三角 Sprite 浮动 + 地面扩散警戒环。3 DrawCall。
 */
export default function AlarmPulse({ buildings, rooms: roomsProp }: Props) {
  const alarmRoomId = useCampusStore((s) => s.alarmRoomId)
  const alarmBuildingId = useCampusStore((s) => s.alarmBuildingId)
  const storeRooms = useCampusStore((s) => s.rooms)
  const rooms = roomsProp ?? storeRooms

  const boxRef = useRef<THREE.Mesh | null>(null)
  const spriteRef = useRef<THREE.Sprite | null>(null)
  const ringRef = useRef<THREE.Mesh | null>(null)

  // 解析告警位置:优先房间(positionHint),否则楼顶中心
  const target = useMemo((): { pos: [number, number, number]; groundY: number } | null => {
    const room = alarmRoomId ? rooms.find((r) => r.id === alarmRoomId) : undefined
    const buildingId = room?.buildingId ?? alarmBuildingId
    const building = buildingId ? buildings.find((b) => b.id === buildingId) : undefined
    if (!building) return null
    if (room) return { pos: roomWorldPosition(room, building), groundY: 0.9 }
    return { pos: [building.center[0], building.height + 3, building.center[1]], groundY: 0.9 }
  }, [alarmRoomId, alarmBuildingId, rooms, buildings])

  const warningTex = useMemo(() => (target ? makeWarningTexture() : null), [target])
  useEffect(() => () => warningTex?.dispose(), [warningTex])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (!target) return
    // 红色呼吸脉冲:emissive 2 + sin(t*4) * 1.5
    if (boxRef.current) {
      const mat = boxRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 2 + Math.sin(t * 4) * 1.5
      boxRef.current.position.set(target.pos[0], target.pos[1] + 1.4, target.pos[2])
    }
    // 告警三角上下浮动
    if (spriteRef.current) {
      spriteRef.current.position.set(target.pos[0], target.pos[1] + 8 + Math.sin(t * 2) * 1.2, target.pos[2])
    }
    // 地面警戒环扩散
    if (ringRef.current) {
      const f = (t * 0.8) % 1
      const s = 1 + f * 2.8
      ringRef.current.scale.set(s, s, 1)
      const mat = ringRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = (1 - f) * 0.7
      ringRef.current.position.set(target.pos[0], target.groundY, target.pos[2])
    }
  })

  if (!target) return null
  return (
    <group>
      {/* 脉冲小 box(告警房间/楼位) */}
      <mesh ref={boxRef} position={[target.pos[0], target.pos[1] + 1.4, target.pos[2]]}>
        <boxGeometry args={[3.2, 2.4, 3.2]} />
        <meshStandardMaterial color="#3a0a08" emissive={ALARM_COLOR} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* 告警三角 Sprite */}
      {warningTex && (
        <sprite ref={spriteRef} position={[target.pos[0], target.pos[1] + 8, target.pos[2]]} scale={[9, 9, 1]}>
          <spriteMaterial map={warningTex} transparent depthWrite={false} toneMapped={false} />
        </sprite>
      )}
      {/* 地面扩散警戒环 */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[target.pos[0], target.groundY, target.pos[2]]}>
        <ringGeometry args={[3.4, 4.2, 48]} />
        <meshBasicMaterial color={ALARM_COLOR} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}
