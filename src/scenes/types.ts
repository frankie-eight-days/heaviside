import type { FDTDEngine, SourceMode, ViewMode } from '../gpu/fdtd'

export type SceneCategory = 'antennas' | 'pcb'

// React-tracked state the scene wants to install. App applies this after the
// scene's apply() runs so the Toolbar / sliders reflect the scene's config.
export interface SceneConfig {
  sourcePeriod: number
  sourceMode: SourceMode
  viewMode: ViewMode
}

export interface Scene {
  id: string
  category: SceneCategory
  name: string
  description: string
  apply: (
    engine: FDTDEngine,
    dims: { width: number; height: number },
  ) => SceneConfig
}
