// 雨/雪粒子(手册 §4.3):相机跟随圆柱域(半径80m 高60m),InstancedMesh + useFrame
// 雨:2000 实例细长条,20m/s 微斜风;雪:1500 小圆片,1.5m/s + 水平摆动
// quality=low 数量减半且关闭摆动;读 uiStore.weather 启停(rain / snow)
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useUIStore } from '../../../store/uiStore'

const DOMAIN_RADIUS = 80
const DOMAIN_HEIGHT = 60
const RAIN_MAX = 2000
const SNOW_MAX = 1500
const RAIN_SPEED = 20 // m/s
const SNOW_SPEED = 1.5 // m/s
const RAIN_WIND_X = 2.5 // 微斜风(m/s)
const RAIN_WIND_Z = 1.2
const SNOW_SWAY = 1.4 // 摆动幅度(m)

// 模块级临时对象,避免 useFrame 内分配
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _e = new THREE.Euler()
const _qSnow = new THREE.Quaternion()
// 雨条统一朝向:长轴(Y)对齐坠落方向(含斜风)
const _qRain = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(RAIN_WIND_X, -RAIN_SPEED, RAIN_WIND_Z).normalize(),
)

/** 域内随机撒点(圆柱盘,x/z 均匀,y 取给定值) */
function scatter(arr: Float32Array, i: number, y: number) {
  const r = DOMAIN_RADIUS * Math.sqrt(Math.random())
  const a = Math.random() * Math.PI * 2
  arr[i * 3] = Math.cos(a) * r
  arr[i * 3 + 1] = y
  arr[i * 3 + 2] = Math.sin(a) * r
}
function scatterXZ(arr: Float32Array, i: number) {
  const r = DOMAIN_RADIUS * Math.sqrt(Math.random())
  const a = Math.random() * Math.PI * 2
  arr[i * 2] = Math.cos(a) * r
  arr[i * 2 + 1] = Math.sin(a) * r
}

export default function RainSnow() {
  const weather = useUIStore((s) => s.weather)
  const quality = useUIStore((s) => s.quality)
  const camera = useThree((s) => s.camera)
  const rainRef = useRef<THREE.InstancedMesh>(null)
  const snowRef = useRef<THREE.InstancedMesh>(null)

  // 粒子状态(域局部坐标):雨用 xyz 连续漂移;雪用基准 x/z + 独立 y + 相位
  const rainPos = useMemo(() => {
    const a = new Float32Array(RAIN_MAX * 3)
    for (let i = 0; i < RAIN_MAX; i++) scatter(a, i, Math.random() * DOMAIN_HEIGHT)
    return a
  }, [])
  const snowBase = useMemo(() => {
    const a = new Float32Array(SNOW_MAX * 2)
    for (let i = 0; i < SNOW_MAX; i++) scatterXZ(a, i)
    return a
  }, [])
  const snowY = useMemo(() => {
    const a = new Float32Array(SNOW_MAX)
    for (let i = 0; i < SNOW_MAX; i++) a[i] = Math.random() * DOMAIN_HEIGHT
    return a
  }, [])
  const snowPhase = useMemo(() => {
    const a = new Float32Array(SNOW_MAX)
    for (let i = 0; i < SNOW_MAX; i++) a[i] = Math.random() * Math.PI * 2
    return a
  }, [])

  const rainCount = quality === 'low' ? RAIN_MAX / 2 : RAIN_MAX
  const snowCount = quality === 'low' ? SNOW_MAX / 2 : SNOW_MAX
  const swayOn = quality !== 'low'

  const stepRain = (d: number) => {
    const mesh = rainRef.current
    if (!mesh) return
    mesh.count = rainCount
    for (let i = 0; i < rainCount; i++) {
      let y = rainPos[i * 3 + 1] - RAIN_SPEED * d
      rainPos[i * 3] += RAIN_WIND_X * d
      rainPos[i * 3 + 2] += RAIN_WIND_Z * d
      if (y < 0) {
        scatter(rainPos, i, DOMAIN_HEIGHT) // 落地回收到顶部并换落点
        y = DOMAIN_HEIGHT
      } else {
        rainPos[i * 3 + 1] = y
      }
      _p.set(rainPos[i * 3], y, rainPos[i * 3 + 2])
      _m.compose(_p, _qRain, _s)
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  const stepSnow = (d: number, t: number) => {
    const mesh = snowRef.current
    if (!mesh) return
    mesh.count = snowCount
    for (let i = 0; i < snowCount; i++) {
      let y = snowY[i] - SNOW_SPEED * d
      if (y < 0) {
        scatterXZ(snowBase, i)
        y = DOMAIN_HEIGHT
      }
      snowY[i] = y
      const ph = snowPhase[i]
      const x = snowBase[i * 2] + (swayOn ? Math.sin(t * 0.9 + ph) * SNOW_SWAY : 0)
      const z = snowBase[i * 2 + 1] + (swayOn ? Math.cos(t * 0.7 + ph * 1.3) * SNOW_SWAY * 0.7 : 0)
      _e.set(swayOn ? t * 0.6 + ph : ph, ph * 2.1, swayOn ? t * 0.4 + ph : 0)
      _qSnow.setFromEuler(_e)
      _p.set(x, y, z)
      _m.compose(_p, _qSnow, _s)
      mesh.setMatrixAt(i, _m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }

  // 首帧前初始化全部实例矩阵(防止切天气瞬间在原点闪出一坨)
  useLayoutEffect(() => {
    stepRain(0)
    stepSnow(0, 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 天气切换时把域立刻对齐相机,避免从旧位置横扫过来
  useEffect(() => {
    for (const ref of [rainRef, snowRef]) {
      const m = ref.current
      if (m) {
        m.position.x = camera.position.x
        m.position.z = camera.position.z
      }
    }
  }, [weather, camera])

  useFrame((state, delta) => {
    const d = Math.min(delta, 0.05) // 切后台回来防大跳
    const k = Math.min(1, d * 4) // 域平滑跟随相机(只平移不旋转)
    if (weather === 'rain') {
      const mesh = rainRef.current
      if (mesh) {
        mesh.position.x += (state.camera.position.x - mesh.position.x) * k
        mesh.position.z += (state.camera.position.z - mesh.position.z) * k
        stepRain(d)
      }
    } else if (weather === 'snow') {
      const mesh = snowRef.current
      if (mesh) {
        mesh.position.x += (state.camera.position.x - mesh.position.x) * k
        mesh.position.z += (state.camera.position.z - mesh.position.z) * k
        stepSnow(d, state.clock.elapsedTime)
      }
    }
  })

  return (
    <group>
      {/* 雨:细长条(长轴沿坠落方向,统一微斜) */}
      <instancedMesh
        ref={rainRef}
        args={[undefined, undefined, RAIN_MAX]}
        frustumCulled={false}
        visible={weather === 'rain'}
      >
        <boxGeometry args={[0.03, 1.1, 0.03]} />
        <meshBasicMaterial color="#8fa8bf" transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      {/* 雪:小圆片,缓慢翻滚 + 水平摆动 */}
      <instancedMesh
        ref={snowRef}
        args={[undefined, undefined, SNOW_MAX]}
        frustumCulled={false}
        visible={weather === 'snow'}
      >
        <circleGeometry args={[0.09, 6]} />
        <meshBasicMaterial
          color="#dfe7ec"
          transparent
          opacity={0.85}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  )
}
