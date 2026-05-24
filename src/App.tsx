import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GPUCanvas, { type GPUCanvasHandle, type Tool } from './components/GPUCanvas'
import Toolbar, {
  MAT_PEC,
  MAT_MATERIAL,
  MAT_SOURCE,
  type MaterialPreset,
} from './components/Toolbar'
import { dfToSigma, type BrushSpec, type SourceMode, type ViewMode } from './gpu/fdtd'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [dk, setDk] = useState(4.4)
  const [df, setDf] = useState(0.02)
  const [sourcePeriod, setSourcePeriod] = useState(80)
  const [sourceMode, setSourceMode] = useState<SourceMode>('cw')
  const [viewMode, setViewMode] = useState<ViewMode>('ez')
  const [canUndo, setCanUndo] = useState(false)
  const canvasHandle = useRef<GPUCanvasHandle | null>(null)

  const tool: Tool = material === MAT_SOURCE ? 'source' : 'paint'

  const brush = useMemo<BrushSpec>(() => {
    if (material === MAT_PEC) return { epsilonR: 1, sigma: 0, pec: true }
    if (material === MAT_MATERIAL) {
      return { epsilonR: dk, sigma: dfToSigma(dk, df), pec: false }
    }
    return { epsilonR: 1, sigma: 0, pec: false }
  }, [material, dk, df])

  const handlePreset = useCallback((p: MaterialPreset) => {
    setDk(p.dk)
    setDf(p.df)
    setMaterial(MAT_MATERIAL)
  }, [])

  const handleUndo = useCallback(() => {
    canvasHandle.current?.undo()
  }, [])

  const handleResetFields = useCallback(() => {
    canvasHandle.current?.resetFields()
  }, [])

  const handleResetMaterials = useCallback(() => {
    canvasHandle.current?.resetMaterials()
  }, [])

  const handleFirePulse = useCallback(() => {
    canvasHandle.current?.firePulse()
  }, [])

  // Cmd/Ctrl+Z for undo, space bar to fire a pulse when in Pulse mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        handleUndo()
      } else if (
        e.code === 'Space' &&
        sourceMode === 'pulse' &&
        !(e.target instanceof HTMLInputElement)
      ) {
        e.preventDefault()
        handleFirePulse()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo, handleFirePulse, sourceMode])

  return (
    <div className="app">
      <header className="header">
        <h1>EM Playground</h1>
        <span className="subtitle">
          Paint materials, place a source, watch waves interact. Magnitude view
          shows radiation patterns.
        </span>
      </header>
      <Toolbar
        material={material}
        onMaterialChange={setMaterial}
        brushRadius={brushRadius}
        onBrushChange={setBrushRadius}
        dk={dk}
        onDkChange={setDk}
        df={df}
        onDfChange={setDf}
        onPreset={handlePreset}
        sourcePeriod={sourcePeriod}
        onSourcePeriodChange={setSourcePeriod}
        sourceMode={sourceMode}
        onSourceModeChange={setSourceMode}
        onFirePulse={handleFirePulse}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onUndo={handleUndo}
        onResetFields={handleResetFields}
        onResetMaterials={handleResetMaterials}
        canUndo={canUndo}
      />
      <main className="canvas-wrap">
        <GPUCanvas
          ref={canvasHandle}
          tool={tool}
          brush={brush}
          brushRadius={brushRadius}
          sourcePeriod={sourcePeriod}
          sourceMode={sourceMode}
          viewMode={viewMode}
          onUndoStackChange={setCanUndo}
        />
      </main>
    </div>
  )
}
