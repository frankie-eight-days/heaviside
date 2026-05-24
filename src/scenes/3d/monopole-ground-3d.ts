import type { Scene } from '../types'
import type { FDTDEngine3D, ProbeSpec } from '../../gpu/fdtd'

const SC_3D = 0.99 / Math.sqrt(3)
const PEC_BRUSH = { epsilonR: 1, sigma: 0, pec: true }

export const monopoleGround3D: Scene = {
  id: '3d-monopole-ground',
  category: '3d',
  name: 'λ/4 monopole over ground',
  description:
    "A quarter-wave PEC arm pointing up out of a horizontal ground plane. Image theory says this is electrically equivalent to a λ/2 dipole — the ground reflects the upper donut downward into its mirror image. You see the upper half of the donut; below the ground is dark. XZ slice opens with the antenna vertical and the ground as a horizontal line.",
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 100
    const engine3D = engine as FDTDEngine3D
    engine3D.resetMaterials()
    engine3D.resetFields()
    engine3D.setSourcePeriod(period)
    engine3D.setSourceMode('cw')

    const { width: W, height: H } = engine3D.getDims3D()
    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)

    const lambdaCells = period * SC_3D
    const arm = Math.max(2, Math.floor(lambdaCells * 0.225)) // ~λ/4 minus 1 cell for the feed

    // Ground plane: horizontal PEC slab at z = groundZ, spanning the
    // non-PML region in x and y. Put it below center so the antenna sits
    // in the upper half (broadside lobe is visible in the canvas).
    const groundZ = 40
    engine3D.paintBox3D(13, 13, groundZ, W - 14, H - 14, groundZ, PEC_BRUSH)

    // Vertical PEC arm one cell above the ground, going up.
    engine3D.paintBox3D(cx - 1, cy - 1, groundZ + 2, cx + 1, cy + 1, groundZ + 1 + arm, PEC_BRUSH)

    // Source at the feed gap (the single cell between ground and the arm).
    engine3D.setSources3D([
      { x: cx, y: cy, z: groundZ + 1, phase: 0, amplitude: 1, polarization: 'z' },
    ])

    const probes: ProbeSpec[] = [
      // Broadside (above the ground, away from the antenna in +x).
      { x: cx + Math.round(lambdaCells), y: groundZ + arm },
      // Above the antenna (along its axis = polar null).
      { x: cx, y: groundZ + 1 + arm + Math.round(lambdaCells * 0.6) },
      // Below the ground (shadow — should read ~0).
      { x: cx + Math.round(lambdaCells * 0.5), y: groundZ - Math.round(lambdaCells * 0.4) },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
      polarization: '3D',
      sliceAxis: 'xz',
      sliceDepth: cy,
    }
  },
}
