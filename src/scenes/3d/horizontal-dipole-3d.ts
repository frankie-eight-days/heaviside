import type { Scene } from '../types'
import type { FDTDEngine3D, ProbeSpec } from '../../gpu/fdtd'

const SC_3D = 0.99 / Math.sqrt(3)
const PEC_BRUSH = { epsilonR: 1, sigma: 0, pec: true }

export const horizontalDipole3D: Scene = {
  id: '3d-horizontal-dipole',
  category: '3d',
  name: 'Horizontal λ/2 dipole',
  description:
    "Same dipole as the vertical one, rotated 90° to lie along the x-axis. Source polarization is now 'x'. XY slice shows the figure-8 cross-section (now horizontal in the canvas). YZ slice (perpendicular to the antenna) shows the full broadside ring. Same donut as the vertical case, just oriented around x.",
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 60
    const engine3D = engine as FDTDEngine3D
    engine3D.resetMaterials()
    engine3D.resetFields()
    engine3D.setSourcePeriod(period)
    engine3D.setSourceMode('cw')

    const { width: W, height: H, depth: D } = engine3D.getDims3D()
    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)
    const cz = Math.floor(D / 2)

    const lambdaCells = period * SC_3D
    const arm = Math.max(2, Math.floor(lambdaCells * 0.21))
    const gap = 2

    // 3×3 cross-section in (y, z), arms along x.
    engine3D.paintBox3D(cx + gap + 1, cy - 1, cz - 1, cx + gap + arm, cy + 1, cz + 1, PEC_BRUSH)
    engine3D.paintBox3D(cx - gap - arm, cy - 1, cz - 1, cx - gap - 1, cy + 1, cz + 1, PEC_BRUSH)

    engine3D.setSources3D([
      { x: cx, y: cy, z: cz, phase: 0, amplitude: 1, polarization: 'x' },
    ])

    // XY slice through z=cz shows the antenna as a horizontal line, with the
    // figure-8 lobes above/below it.
    const probes: ProbeSpec[] = [
      // Broadside ±y at 1λ — should be strong.
      { x: cx, y: cy + Math.round(lambdaCells) },
      { x: cx, y: cy - Math.round(lambdaCells) },
      // Endfire ±x past the tips — should be null (axis of the donut).
      { x: cx + arm + Math.round(lambdaCells), y: cy },
      { x: cx - arm - Math.round(lambdaCells), y: cy },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
      polarization: '3D',
      sliceAxis: 'xy',
      sliceDepth: cz,
    }
  },
}
