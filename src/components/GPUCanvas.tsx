import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { initGPU } from '../gpu/init'
import {
  createFDTD,
  type BrushSpec,
  type FDTDEngine,
  type MaterialSnapshot,
} from '../gpu/fdtd'

const MAX_UNDO = 10

export interface GPUCanvasHandle {
  undo: () => void
  resetMaterials: () => void
  resetFields: () => void
  canUndo: () => boolean
}

interface GPUCanvasProps {
  brush: BrushSpec
  brushRadius: number
  onUndoStackChange: (canUndo: boolean) => void
}

const GPUCanvas = forwardRef<GPUCanvasHandle, GPUCanvasProps>(function GPUCanvas(
  { brush, brushRadius, onUndoStackChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<FDTDEngine | null>(null)
  const undoStackRef = useRef<MaterialSnapshot[]>([])
  const isPaintingRef = useRef(false)
  const brushRef = useRef(brush)
  const brushRadiusRef = useRef(brushRadius)
  const [error, setError] = useState<string | null>(null)

  // Keep refs in sync with props so event handlers (closed over once) see latest values.
  useEffect(() => {
    brushRef.current = brush
  }, [brush])
  useEffect(() => {
    brushRadiusRef.current = brushRadius
  }, [brushRadius])

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
    canUndo: () => undoStackRef.current.length > 0,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let raf = 0
    let cancelled = false

    const parent = canvas.parentElement
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

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const engine = engineRef.current
    if (!engine) return
    e.currentTarget.setPointerCapture(e.pointerId)
    isPaintingRef.current = true
    undoStackRef.current.push(engine.snapshotMaterials())
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift()
    onUndoStackChange(true)
    const g = eventToGrid(e)
    if (g) engine.paint(g[0], g[1], brushRadiusRef.current, brushRef.current)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isPaintingRef.current) return
    const engine = engineRef.current
    if (!engine) return
    const g = eventToGrid(e)
    if (g) engine.paint(g[0], g[1], brushRadiusRef.current, brushRef.current)
  }

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    <canvas
      ref={canvasRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    />
  )
})

export default GPUCanvas
