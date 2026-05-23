import { useCallback, useEffect, useRef, useState } from 'react'
import GPUCanvas, { type GPUCanvasHandle } from './components/GPUCanvas'
import Toolbar from './components/Toolbar'
import { MAT_PEC } from './gpu/fdtd'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [canUndo, setCanUndo] = useState(false)
  const canvasHandle = useRef<GPUCanvasHandle | null>(null)

  const handleUndo = useCallback(() => {
    canvasHandle.current?.undo()
  }, [])

  const handleClear = useCallback(() => {
    canvasHandle.current?.clear()
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
        onUndo={handleUndo}
        onClear={handleClear}
        canUndo={canUndo}
      />
      <main className="canvas-wrap">
        <GPUCanvas
          ref={canvasHandle}
          material={material}
          brushRadius={brushRadius}
          onUndoStackChange={setCanUndo}
        />
      </main>
    </div>
  )
}
