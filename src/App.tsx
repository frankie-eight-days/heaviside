import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GPUCanvas, { type GPUCanvasHandle } from './components/GPUCanvas'
import Toolbar, {
  MAT_PEC,
  MAT_LOSSY,
  MAT_DIELECTRIC,
} from './components/Toolbar'
import type { BrushSpec } from './gpu/fdtd'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [epsilonR, setEpsilonR] = useState(4)
  const [sigma, setSigma] = useState(1)
  const [canUndo, setCanUndo] = useState(false)
  const canvasHandle = useRef<GPUCanvasHandle | null>(null)

  const brush = useMemo<BrushSpec>(() => {
    if (material === MAT_PEC) return { epsilonR: 1, sigma: 0, pec: true }
    if (material === MAT_DIELECTRIC) return { epsilonR, sigma: 0, pec: false }
    if (material === MAT_LOSSY) return { epsilonR: 1, sigma, pec: false }
    return { epsilonR: 1, sigma: 0, pec: false }
  }, [material, epsilonR, sigma])

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
          Paint PEC / lossy / dielectric materials and watch waves interact.
        </span>
      </header>
      <Toolbar
        material={material}
        onMaterialChange={setMaterial}
        brushRadius={brushRadius}
        onBrushChange={setBrushRadius}
        epsilonR={epsilonR}
        onEpsilonRChange={setEpsilonR}
        sigma={sigma}
        onSigmaChange={setSigma}
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
