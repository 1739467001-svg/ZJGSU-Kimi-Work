import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useCampusStore } from '../../../store/campusStore'

/** 扫描参数:30m 宽亮带,沿 x -800 → +800,1.2s 扫完 */
const DURATION = 1.2
const MIN_X = -800
const MAX_X = 800
const BAND_WIDTH = 30
const PLANE_W = 1700
const PLANE_H = 1000
const SCAN_Y = 2
const SCAN_COLOR = '#3aa7ff'

const VERT = /* glsl */ `
varying float vX;
void main() {
  vX = position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
varying float vX;
uniform float uProgress;
uniform float uBandWidth;
uniform float uMinX;
uniform float uMaxX;
uniform vec3 uColor;
void main() {
  float cx = mix(uMinX, uMaxX, uProgress);
  float d = abs(vX - cx);
  float core = 1.0 - smoothstep(0.0, uBandWidth, d);
  float glow = (1.0 - smoothstep(0.0, uBandWidth * 3.0, d)) * 0.22;
  float envelope = sin(3.14159265 * clamp(uProgress, 0.0, 1.0));
  float a = (pow(core, 1.5) + glow) * envelope * 0.85;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/**
 * Agent 扫描光:覆盖全校的透明平面(y=2),亮带沿 x 扫过。
 * campusStore.scanTrigger 变化时重播,扫完自动隐藏。1 DrawCall。
 */
export default function ScanLine() {
  const scanTrigger = useCampusStore((s) => s.scanTrigger)
  const [visible, setVisible] = useState(false)
  const progress = useRef(0)
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uProgress: { value: 0 },
          uBandWidth: { value: BAND_WIDTH },
          uMinX: { value: MIN_X },
          uMaxX: { value: MAX_X },
          uColor: { value: new THREE.Color(SCAN_COLOR) },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  materialRef.current = material

  useEffect(() => () => material.dispose(), [material])

  // scanTrigger 变化(Date.now() 时间戳,初值 0 不触发)→ 重播
  useEffect(() => {
    if (!scanTrigger) return
    progress.current = 0
    setVisible(true)
  }, [scanTrigger])

  useFrame((_, delta) => {
    if (!visible || !materialRef.current) return
    progress.current += delta / DURATION
    if (progress.current >= 1) {
      materialRef.current.uniforms.uProgress.value = 1
      setVisible(false)
      return
    }
    materialRef.current.uniforms.uProgress.value = progress.current
  })

  if (!visible) return null
  return (
    <mesh
      position={[0, SCAN_Y, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      frustumCulled={false}
      renderOrder={10}
    >
      <planeGeometry args={[PLANE_W, PLANE_H]} />
    </mesh>
  )
}
