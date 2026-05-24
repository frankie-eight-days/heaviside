import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { initGPU, type GPUContext } from '../gpu/init'
import { createEngine } from '../gpu/engine'
import {
  type BrushSpec,
  type FDTDEngine,
  type FDTDEngine3D,
  type MaterialSnapshot,
  type ModulationParams,
  type Polarization,
  type ProbeHistorySnapshot,
  type ProbeSpec,
  type SourceMode,
  type SourcePolarization,
  type SourceWaveform,
  type ViewAxis3D,
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
  polarization: Polarization
  onPolarizationChange: (p: Polarization) => void
  sourcePolarization: SourcePolarization
  sourcePeriod: number
  sourceMode: SourceMode
  sourceWaveform: SourceWaveform
  modulation: ModulationParams
  viewMode: ViewMode
  displayGain: number
  sliceAxis: ViewAxis3D
  sliceDepth: number
  cameraTheta: number
  cameraPhi: number
  cameraDistance: number
  onCameraOrbit: (dTheta: number, dPhi: number) => void
  showGrid: boolean
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
    polarization,
    onPolarizationChange,
    sourcePolarization,
    sourcePeriod,
    sourceMode,
    sourceWaveform,
    modulation,
    viewMode,
    displayGain,
    sliceAxis,
    sliceDepth,
    cameraTheta,
    cameraPhi,
    cameraDistance,
    onCameraOrbit,
    showGrid,
    probes,
    probesPerLine,
    onProbesPlaced,
    onUndoStackChange,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const gridRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const gpuRef = useRef<GPUContext | null>(null)
  const engineRef = useRef<FDTDEngine | null>(null)
  const lastSizeRef = useRef<[number, number]>([0, 0])
  const undoStackRef = useRef<MaterialSnapshot[]>([])
  const isPaintingRef = useRef(false)
  const brushRef = useRef(brush)
  const brushRadiusRef = useRef(brushRadius)
  const toolRef = useRef(tool)
  const probesPerLineRef = useRef(probesPerLine)
  const polarizationRef = useRef(polarization)
  const sourcePolarizationRef = useRef(sourcePolarization)
  const showGridRef = useRef(showGrid)
  const sourcePeriodRef = useRef(sourcePeriod)
  const sourceModeRef = useRef(sourceMode)
  const sourceWaveformRef = useRef(sourceWaveform)
  const modulationRef = useRef(modulation)
  const viewModeRef = useRef(viewMode)
  const probesRef = useRef(probes)
  const dragStartRef = useRef<[number, number] | null>(null)
  const dragEndRef = useRef<[number, number] | null>(null)
  const dragToolRef = useRef<Tool | null>(null)
  // Volume-mode orbit drag state — last raw pointer position. We feed deltas
  // back to App via onCameraOrbit so the camera state stays in App and the
  // useEffect[cameraTheta/Phi] path writes the engine uniform.
  const orbitDragRef = useRef<{ x: number; y: number } | null>(null)
  const viewModeRef2 = useRef(viewMode)
  useEffect(() => {
    viewModeRef2.current = viewMode
  }, [viewMode])
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
    sourcePolarizationRef.current = sourcePolarization
  }, [sourcePolarization])
  useEffect(() => {
    showGridRef.current = showGrid
  }, [showGrid])
  useEffect(() => {
    sourcePeriodRef.current = sourcePeriod
    engineRef.current?.setSourcePeriod(sourcePeriod)
  }, [sourcePeriod])
  useEffect(() => {
    sourceModeRef.current = sourceMode
    engineRef.current?.setSourceMode(sourceMode)
  }, [sourceMode])
  useEffect(() => {
    sourceWaveformRef.current = sourceWaveform
    engineRef.current?.setSourceWaveform(sourceWaveform)
  }, [sourceWaveform])
  useEffect(() => {
    modulationRef.current = modulation
    engineRef.current?.setModulation(modulation)
  }, [modulation])
  useEffect(() => {
    viewModeRef.current = viewMode
    engineRef.current?.setViewMode(viewMode)
  }, [viewMode])
  useEffect(() => {
    engineRef.current?.setDisplayGain(displayGain)
  }, [displayGain])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || engine.polarization !== '3D') return
    ;(engine as FDTDEngine3D).setViewSlice(sliceAxis, sliceDepth)
  }, [sliceAxis, sliceDepth])
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || engine.polarization !== '3D') return
    const [w, h] = lastSizeRef.current
    const aspect = h > 0 ? w / h : 1
    ;(engine as FDTDEngine3D).setCameraOrbit(cameraTheta, cameraPhi, cameraDistance, aspect)
  }, [cameraTheta, cameraPhi, cameraDistance])
  useEffect(() => {
    probesRef.current = probes
    engineRef.current?.setProbes(probes)
  }, [probes])

  // Apply all React-tracked settings to a freshly-created engine. Used by
  // both the initial-mount path and the polarization swap path.
  const seedEngineFromProps = (engine: FDTDEngine) => {
    engine.setSourcePeriod(sourcePeriodRef.current)
    engine.setSourceMode(sourceModeRef.current)
    engine.setSourceWaveform(sourceWaveformRef.current)
    engine.setModulation(modulationRef.current)
    engine.setViewMode(viewModeRef.current)
    engine.setProbes(probesRef.current)
  }

  // Polarization swap. Snapshots materials, destroys the old engine, creates
  // the new one, restores materials. Fields are intentionally cleared (no
  // sensible mapping between Ez and Hz). Probes keep positions; history wipes.
  // See ADR 0009.
  const swapEngineTo = (target: Polarization): FDTDEngine | null => {
    const gpu = gpuRef.current
    if (!gpu) return null
    const old = engineRef.current
    const snapshot = old?.snapshotMaterials() ?? null
    old?.destroy()

    const fresh = createEngine(gpu, target)
    const [w, h] = lastSizeRef.current
    if (w > 0 && h > 0) fresh.resize(w, h)
    if (snapshot && snapshot.epsSig.length > 0) fresh.restoreMaterials(snapshot)
    seedEngineFromProps(fresh)
    engineRef.current = fresh
    polarizationRef.current = target
    undoStackRef.current = []
    onUndoStackChange(false)
    return fresh
  }

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
      let engine = engineRef.current
      if (!engine) return null
      // Synchronously swap engines if the scene declares a different
      // polarization. Then run apply on the (possibly new) engine and
      // notify the parent of the polarization change.
      if (scene.polarization && scene.polarization !== engine.polarization) {
        const swapped = swapEngineTo(scene.polarization)
        if (!swapped) return null
        engine = swapped
        onPolarizationChange(scene.polarization)
      }
      const dims = engine.getDims()
      if (dims.width === 0 || dims.height === 0) return null
      undoStackRef.current = []
      onUndoStackChange(false)
      const cfg = scene.apply(engine, dims)
      return { ...cfg, polarization: engine.polarization }
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
    const fit = () => {
      const target = parent ?? canvas
      const w = Math.max(8, target.clientWidth)
      const h = Math.max(8, target.clientHeight)
      const [lastW, lastH] = lastSizeRef.current
      if (w !== lastW || h !== lastH) {
        lastSizeRef.current = [w, h]
        const dpr = window.devicePixelRatio || 1
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        canvas.width = Math.max(1, Math.floor(w * dpr))
        canvas.height = Math.max(1, Math.floor(h * dpr))
        for (const layer of [gridRef.current, overlayRef.current]) {
          if (layer) {
            layer.style.width = `${w}px`
            layer.style.height = `${h}px`
            layer.width = canvas.width
            layer.height = canvas.height
          }
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
        gpuRef.current = gpu
        const engine = createEngine(gpu, polarizationRef.current)
        const [w, h] = lastSizeRef.current
        engine.resize(w, h)
        seedEngineFromProps(engine)
        engineRef.current = engine

        const tick = () => {
          if (cancelled) return
          engineRef.current?.step()
          drawGrid()
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
      gpuRef.current = null
    }
  }, [])

  // Manual polarization-toggle path. Skipped on initial mount and when the
  // engine was already swapped by applyScene (engineRef.current.polarization
  // already matches). See ADR 0009.
  useEffect(() => {
    if (!gpuRef.current) return
    const engine = engineRef.current
    if (!engine) return
    if (engine.polarization === polarization) return
    swapEngineTo(polarization)
  }, [polarization])

  // λ-grid overlay: minor lines every λ/4, major every λ, anchored to the
  // first source's position (or canvas center if no source). Pure decoration.
  // Drawing is cheap (~50 line strokes + ~10 fillText) so we redraw every
  // rAF tick rather than tracking change conditions.
  const SC = 1 / Math.SQRT2
  const drawGrid = () => {
    const overlay = gridRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    if (!showGridRef.current) return
    const engine = engineRef.current
    if (!engine) return

    const { width: W, height: H } = engine.getDims()
    if (W === 0 || H === 0) return
    const lambdaCells = sourcePeriodRef.current * SC
    if (lambdaCells < 4) return

    const sources = engine.getSources()
    const anchorX = sources[0]?.x ?? W / 2
    const anchorY = sources[0]?.y ?? H / 2

    const dpr = window.devicePixelRatio || 1
    const cssW = overlay.clientWidth
    const cssH = overlay.clientHeight
    if (cssW === 0 || cssH === 0) return
    const sx = (cssW * dpr) / W
    const sy = (cssH * dpr) / H

    const maxN = Math.ceil(Math.max(W, H) / lambdaCells) + 1

    // Minor lines (every λ/4) — skip indices that coincide with major lines
    ctx.lineWidth = 1 * dpr
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)'
    for (let n = -maxN * 4; n <= maxN * 4; n++) {
      if (n % 4 === 0) continue
      const cellX = anchorX + (n * lambdaCells) / 4
      if (cellX < 0 || cellX > W) continue
      const x = cellX * sx
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, overlay.height)
      ctx.stroke()
    }
    for (let n = -maxN * 4; n <= maxN * 4; n++) {
      if (n % 4 === 0) continue
      const cellY = anchorY + (n * lambdaCells) / 4
      if (cellY < 0 || cellY > H) continue
      const y = cellY * sy
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(overlay.width, y)
      ctx.stroke()
    }

    // Major lines (every λ)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    for (let n = -maxN; n <= maxN; n++) {
      const cellX = anchorX + n * lambdaCells
      if (cellX < 0 || cellX > W) continue
      const x = cellX * sx
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, overlay.height)
      ctx.stroke()
    }
    for (let n = -maxN; n <= maxN; n++) {
      const cellY = anchorY + n * lambdaCells
      if (cellY < 0 || cellY > H) continue
      const y = cellY * sy
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(overlay.width, y)
      ctx.stroke()
    }

    // λ-multiple labels along the bottom edge
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)'
    ctx.font = `${11 * dpr}px ui-monospace, SFMono-Regular, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    for (let n = -maxN; n <= maxN; n++) {
      if (n === 0) continue
      const cellX = anchorX + n * lambdaCells
      if (cellX < 12 || cellX > W - 12) continue
      const x = cellX * sx
      const sign = n > 0 ? '+' : ''
      ctx.fillText(`${sign}${n}λ`, x, overlay.height - 6 * dpr)
    }

    // Inline "λ = N cells" badge at the anchor
    const anchorPxX = anchorX * sx
    const anchorPxY = anchorY * sy
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    const label = `λ = ${Math.round(lambdaCells)} cells`
    const padX = 4 * dpr
    const padY = 3 * dpr
    const metrics = ctx.measureText(label)
    const boxW = metrics.width + padX * 2
    const boxH = 14 * dpr
    ctx.fillRect(anchorPxX + 8 * dpr, anchorPxY + 8 * dpr, boxW, boxH)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillText(label, anchorPxX + 8 * dpr + padX, anchorPxY + 8 * dpr + padY)
  }

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
    // In volume mode, any drag rotates the camera regardless of tool.
    if (viewModeRef2.current === 'volume') {
      orbitDragRef.current = { x: e.clientX, y: e.clientY }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const g = eventToGrid(e)
    if (!g) return
    if (toolRef.current === 'source') {
      engine.setSources([
        {
          x: g[0],
          y: g[1],
          phase: 0,
          amplitude: 1,
          polarization: sourcePolarizationRef.current,
        },
      ])
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
    if (orbitDragRef.current) {
      const last = orbitDragRef.current
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      orbitDragRef.current = { x: e.clientX, y: e.clientY }
      const canvas = canvasRef.current
      const w = canvas?.clientWidth ?? 800
      // Drag the full canvas width to do a full rotation.
      onCameraOrbit((dx * 2 * Math.PI) / w, (dy * Math.PI) / w)
      return
    }
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
    if (orbitDragRef.current) {
      orbitDragRef.current = null
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      return
    }
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
      <canvas ref={gridRef} className="overlay-canvas grid-canvas" />
      <canvas ref={overlayRef} className="overlay-canvas" />
    </div>
  )
})

export default GPUCanvas
