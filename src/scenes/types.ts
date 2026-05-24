import type {
  FDTDEngine,
  Polarization,
  ProbeSpec,
  SourceMode,
  ViewAxis3D,
  ViewMode,
} from '../gpu/fdtd'

export type SceneCategory = 'antennas' | 'pcb' | '3d'

// React-tracked state the scene wants to install. App applies this after the
// scene's apply() runs so the Toolbar / sliders reflect the scene's config.
export interface SceneConfig {
  sourcePeriod: number
  sourceMode: SourceMode
  viewMode: ViewMode
  // Optional pre-placed probes. App replaces the probe list entirely (no
  // merge with existing probes) — scenes that omit this clear any prior
  // probes on load.
  probes?: ProbeSpec[]
  // Polarization this scene was designed for. GPUCanvas swaps engines to
  // match before running apply(). See ADR 0009. Omitted = runs on whatever
  // polarization is currently active.
  polarization?: Polarization
  // 3D-only: which slice to open with. App pushes these into its sliceAxis /
  // sliceDepth state after apply() returns, the useEffect in GPUCanvas then
  // calls setViewSlice. Scene-returned 2D probes are interpreted in this
  // slice's coordinate system.
  sliceAxis?: ViewAxis3D
  sliceDepth?: number
}

export interface Scene {
  id: string
  category: SceneCategory
  name: string
  description: string
  // Optional declared polarization. If set, loading the scene auto-switches
  // the engine. If unset, the scene runs on whatever is currently active.
  polarization?: Polarization
  apply: (
    engine: FDTDEngine,
    dims: { width: number; height: number },
  ) => SceneConfig
}
