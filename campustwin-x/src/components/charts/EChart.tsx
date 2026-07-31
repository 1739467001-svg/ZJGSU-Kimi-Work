import { useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

/** 图表点击参数(屏蔽 echarts 内部事件类型,消费方按 dataIndex 反查数据) */
export interface EChartClickParams {
  dataIndex: number
  name: string
}

interface EChartProps {
  option: EChartsOption
  height?: number
  onClick?: (p: EChartClickParams) => void
  style?: CSSProperties
}

/** 深色指挥中心基调的 echarts React 封装:init / resize / dispose / setOption */
export function EChart({ option, height = 200, onClick, style }: EChartProps) {
  const domRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)
  const clickRef = useRef(onClick)

  useEffect(() => {
    clickRef.current = onClick
  }, [onClick])

  useEffect(() => {
    const el = domRef.current
    if (!el) return
    const chart = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = chart
    chart.on('click', (p: unknown) => {
      const d = p as { dataIndex?: unknown; name?: unknown }
      clickRef.current?.({
        dataIndex: typeof d.dataIndex === 'number' ? d.dataIndex : -1,
        name: typeof d.name === 'string' ? d.name : '',
      })
    })
    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const themed: EChartsOption = {
      backgroundColor: 'transparent',
      textStyle: { color: '#dde3e8', fontFamily: 'system-ui, "PingFang SC", sans-serif' },
      ...option,
    }
    chart.setOption(themed, { notMerge: true })
  }, [option])

  return <div ref={domRef} style={{ width: '100%', height, ...style }} />
}
