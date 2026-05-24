import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import GPUCanvas, { type GPUCanvasHandle, type Tool } from './components/GPUCanvas'
import Toolbar, {
  MAT_PEC,
  MAT_MATERIAL,
  MAT_SOURCE,
  MAT_PROBE,
  type MaterialPreset,
} from './components/Toolbar'
import ExamplesSidebar from './components/ExamplesSidebar'
import MeasurementPanel from './components/MeasurementPanel'
import {
  dfToSigma,
  type BrushSpec,
  type ModulationParams,
  type ProbeSpec,
  type SourceMode,
  type SourceWaveform,
  type ViewMode,
} from './gpu/fdtd'
import { ALL_SCENES, type Scene } from './scenes'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [dk, setDk] = useState(4.4)
  const [df, setDf] = useState(0.02)
  const [sourcePeriod, setSourcePeriod] = useState(80)
  const [sourceMode, setSourceMode] = useState<SourceMode>('cw')
  const [sourceWaveform, setSourceWaveform] = useState<SourceWaveform>('sine')
  const [modulation, setModulation] = useState<ModulationParams>({
    modPeriod: 400,
    amDepth: 0.5,
    fmIndex: 2,
    squareEdge: 20,
  })
  const [viewMode, setViewMode] = useState<ViewMode>('ez')
  const [canUndo, setCanUndo] = useState(false)
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [probes, setProbes] = useState<ProbeSpec[]>([])
  const canvasHandle = useRef<GPUCanvasHandle | null>(null)

  const tool: Tool =
    material === MAT_SOURCE ? 'source' : material === MAT_PROBE ? 'probe' : 'paint'

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

  const handleModulationChange = useCallback((params: Partial<ModulationParams>) => {
    setModulation((prev) => ({ ...prev, ...params }))
  }, [])

  const handleProbePlaced = useCallback((x: number, y: number) => {
    setProbes((prev) => {
      if (prev.length >= 8) return prev
      return [...prev, { x, y }]
    })
  }, [])

  const handleRemoveProbe = useCallback((index: number) => {
    setProbes((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleClearProbes = useCallback(() => {
    setProbes([])
  }, [])

  const handleSceneSelect = useCallback((scene: Scene) => {
    const cfg = canvasHandle.current?.applyScene(scene)
    if (cfg) {
      setSourcePeriod(cfg.sourcePeriod)
      setSourceMode(cfg.sourceMode)
      setViewMode(cfg.viewMode)
    }
    setActiveSceneId(scene.id)
  }, [])

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
          Paint materials, place sources and probes. Magnitude shows radiation
          patterns. Probes feed the spectrum analyzer on the right.
        </span>
      </header>
      <ExamplesSidebar
        scenes={ALL_SCENES}
        activeSceneId={activeSceneId}
        onSelect={handleSceneSelect}
      />
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
        sourceWaveform={sourceWaveform}
        onSourceWaveformChange={setSourceWaveform}
        modulation={modulation}
        onModulationChange={handleModulationChange}
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
          sourceWaveform={sourceWaveform}
          modulation={modulation}
          viewMode={viewMode}
          probes={probes}
          onProbePlaced={handleProbePlaced}
          onUndoStackChange={setCanUndo}
        />
      </main>
      <MeasurementPanel
        probes={probes}
        sourcePeriod={sourcePeriod}
        canvasHandle={canvasHandle}
        onRemoveProbe={handleRemoveProbe}
        onClearProbes={handleClearProbes}
      />
    </div>
  )
}
