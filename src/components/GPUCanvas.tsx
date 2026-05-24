import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { initGPU } from '../gpu/init'
import {
  createFDTD,
  type BrushSpec,
  type FDTDEngine,
  type MaterialSnapshot,
  type ModulationParams,
  type ProbeHistorySnapshot,
  type ProbeSpec,
  type SourceMode,
  type SourceWaveform,
  type ViewMode,
} from '../gpu/fdtd'
import type { Scene, SceneConfig } from '../scenes/types'

const MAX_UNDO = 10
const PROBE_LINE_MIN_DRAG_CELLS = 5

export type Tool = 'paint' | 'source' | 'probe'

export interface GPUCanvasHandle {
  undo: () => void
  resetMaterials: () => void
  resetFields: () => void
  firePulse: () => void
  applyScene: (scene: Scene) => SceneConfig | null
  getProbeHistory: () => ProbeHistorySnapshot | null
  canUndo: () => boolean
}

interface GPUCanvasProps {
  tool: Tool
  brush: BrushSpec
  brushRadius: number
  sourcePeriod: number
  sourceMode: SourceMode
  sourceWaveform: SourceWaveform
  modulation: ModulationParams
  viewMode: ViewMode
  probes: ProbeSpec[]
  probesPerLine: number
  onProbesPlaced: (positions: ProbeSpec[]) => void
  onUndoStackChange: (canUndo: boolean) => void
}

const GPUCanvas = forwardRef<GPUCanvasHandle, GPUCanvasProps>(function GPUCanvas(
  {
    tool,
    brush,
    brushRadius,
    sourcePeriod,
    sourceMode,
    sourceWaveform,
    modulation,
    viewMode,
    probes,
    probesPerLine,
    onProbesPlaced,
    onUndoStackChange,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<FDTDEngine | null>(null)
  const undoStackRef = useRef<MaterialSnapshot[]>([])
  const isPaintingRef = useRef(false)
  const brushRef = useRef(brush)
  const brushRadiusRef = useRef(brushRadius)
  const toolRef = useRef(tool)
  const probesPerLineRef = useRef(probesPerLine)
  const dragStartRef = useRef<[number, number] | null>(null)
  const dragEndRef = useRef<[number, number] | null>(null)
  const dragToolRef = useRef<Tool | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    brushRef.current = brush
  }, [brush])
  useEffect(() => {
    brushRadiusRef.current = brushRadius
  }, [brushRadius])
  useEffect(() => {
    toolRef.current = tool
  }, [tool])
  useEffect(() => {
    probesPerLineRef.current = probesPerLine
  }, [probesPerLine])
  useEffect(() => {
    engineRef.current?.setSourcePeriod(sourcePeriod)
  }, [sourcePeriod])
  useEffect(() => {
    engineRef.current?.setSourceMode(sourceMode)
  }, [sourceMode])
  useEffect(() => {
    engineRef.current?.setSourceWaveform(sourceWaveform)
  }, [sourceWaveform])
  useEffect(() => {
    engineRef.current?.setModulation(modulation)
  }, [modulation])
  useEffect(() => {
    engineRef.current?.setViewMode(viewMode)
  }, [viewMode])
  useEffect(() => {
    engineRef.current?.setProbes(probes)
  }, [probes])

  useImperativeHandle(ref, () => ({
    undo: () => {
      const snap = undoStackRef.current.pop()
      if (snap && engineRef.current) {
        engineRef.current.restoreMaterials(snap)
        onUndoStackChange(undoStackRef.current.length > 0)
      }
    },
    resetMaterials: () => {
      const engine = engineRef.current
      if (!engine) return
      undoStackRef.current.push(engine.snapshotMaterials())
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
      engine.resetMaterials()
      onUndoStackChange(undoStackRef.current.length > 0)
    },
    resetFields: () => {
      engineRef.current?.resetFields()
    },
    firePulse: () => {
      engineRef.current?.firePulse()
    },
    applyScene: (scene) => {
      const engine = engineRef.current
      if (!engine) return null
      const dims = engine.getDims()
      if (dims.width === 0 || dims.height === 0) return null
      undoStackRef.current = []
      onUndoStackChange(false)
      return scene.apply(engine, dims)
    },
    getProbeHistory: () => engineRef.current?.getProbeHistory() ?? null,
    canUndo: () => undoStackRef.current.length > 0,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let raf = 0
    let cancelled = false

    const parent = canvas.parentElement?.parentElement
    let lastW = 0
    let lastH = 0
    const fit = () => {
      const target = parent ?? canvas
      const w = Math.max(8, target.clientWidth)
      const h = Math.max(8, target.clientHeight)
      if (w !== lastW || h !== lastH) {
        lastW = w
        lastH = h
        const dpr = window.devicePixelRatio || 1
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        canvas.width = Math.max(1, Math.floor(w * dpr))
        canvas.height = Math.max(1, Math.floor(h * dpr))
        const overlay = overlayRef.current
        if (overlay) {
          overlay.style.width = `${w}px`
          overlay.style.height = `${h}px`
          overlay.width = canvas.width
          overlay.height = canvas.height
        }
      }
      engineRef.current?.resize(w, h)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (parent) ro.observe(parent)

    initGPU(canvas)
      .then((gpu) => {
        if (cancelled) return
        const engine = createFDTD(gpu)
        engine.resize(lastW, lastH)
        engine.setSourcePeriod(sourcePeriod)
        engine.setSourceMode(sourceMode)
        engine.setSourceWaveform(sourceWaveform)
        engine.setModulation(modulation)
        engine.setViewMode(viewMode)
        engine.setProbes(probes)
        engineRef.current = engine

        const tick = () => {
          if (cancelled) return
          engine.step()
          raf = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      engineRef.current?.destroy()
      engineRef.current = null
    }
  }, [])

  const eventToGrid = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): [number, number] | null => {
    const engine = engineRef.current
    if (!engine) return null
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const { width: W, height: H } = engine.getDims()
    const xCss = e.clientX - rect.left
    const yCss = e.clientY - rect.top
    const gridX = Math.floor((xCss / rect.width) * W)
    const gridY = Math.floor((yCss / rect.height) * H)
    return [gridX, gridY]
  }

  const drawProbeLinePreview = () => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    const start = dragStartRef.current
    const end = dragEndRef.current
    const engine = engineRef.current
    if (!start || !end || !engine) return
    const { width: W, height: H } = engine.getDims()
    const cssW = overlay.clientWidth
    const cssH = overlay.clientHeight
    const dpr = window.devicePixelRatio || 1
    const sx = (cssW * dpr) / W
    const sy = (cssH * dpr) / H

    const x1 = (start[0] + 0.5) * sx
    const y1 = (start[1] + 0.5) * sy
    const x2 = (end[0] + 0.5) * sx
    const y2 = (end[1] + 0.5) * sy

    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const dist = Math.sqrt(dx * dx + dy * dy)
    const isLine = dist >= PROBE_LINE_MIN_DRAG_CELLS

    if (isLine) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.lineWidth = 1 * dpr
      ctx.setLineDash([4 * dpr, 4 * dpr])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.setLineDash([])

      const n = probesPerLineRef.current
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.lineWidth = 1 * dpr
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : i / (n - 1)
        const x = x1 + t * (x2 - x1)
        const y = y1 + t * (y2 - y1)
        ctx.beginPath()
        ctx.arc(x, y, 3 * dpr, 0, 2 * Math.PI)
        ctx.fill()
        ctx.stroke()
      }
    } else {
      // Single-click preview: just a circle at the start.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)'
      ctx.lineWidth = 1 * dpr
      ctx.beginPath()
      ctx.arc(x1, y1, 3 * dpr, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }
  }

  const clearOverlay = () => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    if (!engine) return
    const g = eventToGrid(e)
    if (!g) return
    if (toolRef.current === 'source') {
      engine.placeSource(g[0], g[1])
      return
    }
    if (toolRef.current === 'probe') {
      dragStartRef.current = g
      dragEndRef.current = g
      dragToolRef.current = 'probe'
      e.currentTarget.setPointerCapture(e.pointerId)
      drawProbeLinePreview()
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    isPaintingRef.current = true
    undoStackRef.current.push(engine.snapshotMaterials())
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
    onUndoStackChange(true)
    engine.paint(g[0], g[1], brushRadiusRef.current, brushRef.current)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragToolRef.current === 'probe') {
      const g = eventToGrid(e)
      if (g) {
        dragEndRef.current = g
        drawProbeLinePreview()
      }
      return
    }
    if (!isPaintingRef.current) return
    const engine = engineRef.current
    if (!engine) return
    const g = eventToGrid(e)
    if (g) engine.paint(g[0], g[1], brushRadiusRef.current, brushRef.current)
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragToolRef.current === 'probe') {
      const start = dragStartRef.current
      const end = dragEndRef.current
      if (start && end) {
        const dx = end[0] - start[0]
        const dy = end[1] - start[1]
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < PROBE_LINE_MIN_DRAG_CELLS) {
          onProbesPlaced([{ x: start[0], y: start[1] }])
        } else {
          const n = probesPerLineRef.current
          const positions: ProbeSpec[] = []
          for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : i / (n - 1)
            positions.push({
              x: Math.round(start[0] + t * dx),
              y: Math.round(start[1] + t * dy),
            })
          }
          onProbesPlaced(positions)
        }
      }
      clearOverlay()
      dragStartRef.current = null
      dragEndRef.current = null
      dragToolRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      return
    }
    if (!isPaintingRef.current) return
    isPaintingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  if (error) {
    return (
      <div className="error">
        <h3>WebGPU unavailable</h3>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="canvas-stack">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
      />
      <canvas ref={overlayRef} className="overlay-canvas" />
    </div>
  )
})

export default GPUCanvas
