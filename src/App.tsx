import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GPUCanvas, { type GPUCanvasHandle } from './components/GPUCanvas'
import Toolbar, {
  MAT_PEC,
  MAT_MATERIAL,
  type MaterialPreset,
} from './components/Toolbar'
import { dfToSigma, type BrushSpec } from './gpu/fdtd'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [dk, setDk] = useState(4.4)
  const [df, setDf] = useState(0.02)
  const [canUndo, setCanUndo] = useState(false)
  const canvasHandle = useRef<GPUCanvasHandle | null>(null)

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

  // Cmd/Ctrl+Z for undo at the window level.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo])

  return (
    <div className="app">
      <header className="header">
        <h1>EM Playground</h1>
        <span className="subtitle">
          Paint PEC or dielectric/lossy materials (Dk, Df) and watch waves interact.
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
        onUndo={handleUndo}
        onResetFields={handleResetFields}
        onResetMaterials={handleResetMaterials}
        canUndo={canUndo}
      />
      <main className="canvas-wrap">
        <GPUCanvas
          ref={canvasHandle}
          brush={brush}
          brushRadius={brushRadius}
          onUndoStackChange={setCanUndo}
        />
      </main>
    </div>
  )
}
