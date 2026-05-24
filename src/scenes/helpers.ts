import type { BrushSpec, FDTDEngine, SourcePolarization, SourceSpec } from '../gpu/fdtd'
import { dfToSigma } from '../gpu/fdtd'

// Courant number — same as the engine's. Kept here so scenes don't have to
// reach into engine internals to size geometry to a wavelength.
const SC = 1 / Math.SQRT2

export const PEC_BRUSH: BrushSpec = { epsilonR: 1, sigma: 0, pec: true }
export const VACUUM_BRUSH: BrushSpec = { epsilonR: 1, sigma: 0, pec: false }

export function materialBrush(dk: number, df: number): BrushSpec {
  return { epsilonR: dk, sigma: dfToSigma(dk, df), pec: false }
}

// Wavelength in grid cells, given a source period in timesteps.
export function wavelengthCells(period: number): number {
  return period * SC
}

// Vertical column of single-cell sources sharing phase + amplitude.
// Used to express "ports" — multi-cell drivers across the gap between two
// PEC structures, as in microstrip drive-end excitation. Pass polarization
// to drive Ey across the gap for clean TEM excitation in TEz scenes.
export function portColumn(
  x: number,
  y1: number,
  y2: number,
  phase = 0,
  amplitude = 1,
  polarization?: SourcePolarization,
): SourceSpec[] {
  const out: SourceSpec[] = []
  const lo = Math.min(y1, y2)
  const hi = Math.max(y1, y2)
  for (let y = lo; y <= hi; y++) {
    out.push({ x, y, phase, amplitude, polarization })
  }
  return out
}

// Plot y² = 4·p·(x - vertexX), opening toward +x. Used by the parabolic
// reflector scene. Paints with a 1-cell brush so the curve has a little
// thickness and doesn't leak field through single-pixel gaps.
export function paintParabola(
  engine: FDTDEngine,
  vertexX: number,
  focusY: number,
  p: number,
  halfHeight: number,
  brush: BrushSpec,
) {
  for (let dy = -halfHeight; dy <= halfHeight; dy++) {
    const x = Math.floor(vertexX + (dy * dy) / (4 * p))
    engine.paint(x, focusY + dy, 1, brush)
  }
}
