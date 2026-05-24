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
import PolarizationToggle from './components/PolarizationToggle'
import {
  dfToSigma,
  type BrushSpec,
  type ModulationParams,
  type Polarization,
  type ProbeSpec,
  type SourceMode,
  type SourcePolarization,
  type SourceWaveform,
  type ViewAxis3D,
  type ViewMode,
} from './gpu/fdtd'
import { ALL_SCENES, type Scene } from './scenes'
import './App.css'

export default function App() {
  const [material, setMaterial] = useState<number>(MAT_PEC)
  const [brushRadius, setBrushRadius] = useState(5)
  const [dk, setDk] = useState(4.4)
  const [df, setDf] = useState(0.02)
  const [polarization, setPolarization] = useState<Polarization>('TMz')
  const [sourcePolarization, setSourcePolarization] = useState<SourcePolarization>('y')
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
  // Brightness for the signed-field views (Ez/Hz). Magnitude has its own
  // fixed gain that doesn't need tuning. Default 6 matches what felt right
  // for the centered-source smoke test.
  const [displayGain, setDisplayGain] = useState(6)
  // 3D-only slice controls. Defaults: XY at midplane (matches engine init).
  const [sliceAxis, setSliceAxis] = useState<ViewAxis3D>('xy')
  const [sliceDepth, setSliceDepth] = useState(64)
  // 3D volume-mode orbit camera. θ around vertical axis, φ elevation, distance
  // from grid center. Defaults match the engine's initial cameraF32 values.
  const [cameraTheta, setCameraTheta] = useState(Math.PI / 4)
  const [cameraPhi, setCameraPhi] = useState(Math.PI / 6)
  const [cameraDistance, setCameraDistance] = useState(256)
  const [showGrid, setShowGrid] = useState(true)
  const [canUndo, setCanUndo] = useState(false)
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null)
  const [probes, setProbes] = useState<ProbeSpec[]>([])
  const [probesPerLine, setProbesPerLine] = useState(8)
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

  const handleProbesPlaced = useCallback((positions: ProbeSpec[]) => {
    setProbes((prev) => {
      const remaining = 32 - prev.length
      if (remaining <= 0) return prev
      return [...prev, ...positions.slice(0, remaining)]
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
      setProbes(cfg.probes ?? [])
      if (cfg.polarization) setPolarization(cfg.polarization)
    }
    setActiveSceneId(scene.id)
  }, [])

  // Keep the source-polarization default sensible when the engine swaps. The
  // canvas-side onPointerDown reads sourcePolarization to place a new source.
  const handlePolarizationChange = useCallback((p: Polarization) => {
    setPolarization(p)
    setSourcePolarization(p === 'TEz' ? 'y' : 'z')
    // When entering 3D, reset the slice view to the midplane of XY.
    if (p === '3D') {
      setSliceAxis('xy')
      setSliceDepth(64)
    }
  }, [])

  // Switching slice axis resets depth to the midplane of the new axis (which
  // is the same 64 for a cubic 128³ grid; matters once non-cubic dims arrive).
  const handleSliceAxisChange = useCallback((axis: ViewAxis3D) => {
    setSliceAxis(axis)
    setSliceDepth(64)
  }, [])

  // Orbit-camera drag callback from GPUCanvas; (dθ, dφ) in radians.
  const handleCameraOrbit = useCallback((dTheta: number, dPhi: number) => {
    setCameraTheta((t) => t + dTheta)
    setCameraPhi((p) => Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, p + dPhi)))
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
        <PolarizationToggle
          polarization={polarization}
          onChange={handlePolarizationChange}
        />
        <h1>EM Playground</h1>
        <span className="subtitle">
          Paint materials, place sources and probes. Magnitude shows radiation
          patterns. Probes feed the spectrum analyzer on the right.
        </span>
      </header>
      <ExamplesSidebar
        scenes={ALL_SCENES}
        activeSceneId={activeSceneId}
        polarization={polarization}
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
        polarization={polarization}
        sourcePolarization={sourcePolarization}
        onSourcePolarizationChange={setSourcePolarization}
        sourcePeriod={sourcePeriod}
        onSourcePeriodChange={setSourcePeriod}
        sourceMode={sourceMode}
        onSourceModeChange={setSourceMode}
        sourceWaveform={sourceWaveform}
        onSourceWaveformChange={setSourceWaveform}
        modulation={modulation}
        onModulationChange={handleModulationChange}
        onFirePulse={handleFirePulse}
        probesPerLine={probesPerLine}
        onProbesPerLineChange={setProbesPerLine}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        displayGain={displayGain}
        onDisplayGainChange={setDisplayGain}
        sliceAxis={sliceAxis}
        onSliceAxisChange={handleSliceAxisChange}
        sliceDepth={sliceDepth}
        onSliceDepthChange={setSliceDepth}
        cameraDistance={cameraDistance}
        onCameraDistanceChange={setCameraDistance}
        showGrid={showGrid}
        onShowGridChange={setShowGrid}
        onUndo={handleUndo}
        onResetFields={handleResetFields}
        onResetMaterials={handleResetMaterials}
        onResetProbes={handleClearProbes}
        canUndo={canUndo}
      />
      <main className="canvas-wrap">
        <GPUCanvas
          ref={canvasHandle}
          tool={tool}
          brush={brush}
          brushRadius={brushRadius}
          polarization={polarization}
          onPolarizationChange={handlePolarizationChange}
          sourcePolarization={sourcePolarization}
          sourcePeriod={sourcePeriod}
          sourceMode={sourceMode}
          sourceWaveform={sourceWaveform}
          modulation={modulation}
          viewMode={viewMode}
          displayGain={displayGain}
          sliceAxis={sliceAxis}
          sliceDepth={sliceDepth}
          cameraTheta={cameraTheta}
          cameraPhi={cameraPhi}
          cameraDistance={cameraDistance}
          onCameraOrbit={handleCameraOrbit}
          showGrid={showGrid}
          probes={probes}
          probesPerLine={probesPerLine}
          onProbesPlaced={handleProbesPlaced}
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
