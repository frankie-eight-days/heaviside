import type { Scene } from '../types'
import type { FDTDEngine3D, ProbeSpec } from '../../gpu/fdtd'

const SC_3D = 0.99 / Math.sqrt(3)

export const broadsideArray3D: Scene = {
  id: '3d-broadside-array',
  category: '3d',
  name: '2-element broadside array',
  description:
    "Two Ez-polarized point sources spaced λ/2 along x, driven in phase. Broadside (along y, perpendicular to the array axis) the two wavefronts add constructively → strong lobe. Endfire (along x, the array axis) the half-λ path difference makes them cancel → null. XY slice opens to show the in-plane pattern.",
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 100
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
    const half = Math.floor(lambdaCells / 4) // λ/4 each side of center → λ/2 total spacing

    engine3D.setSources3D([
      { x: cx - half, y: cy, z: cz, phase: 0, amplitude: 1, polarization: 'z' },
      { x: cx + half, y: cy, z: cz, phase: 0, amplitude: 1, polarization: 'z' },
    ])

    // XY slice through z=cz. Sources sit as two cyan rings along the x axis.
    // Probes ±x = endfire (null), ±y = broadside (strong).
    const probes: ProbeSpec[] = [
      // Broadside ±y at 1λ from center
      { x: cx, y: cy + Math.round(lambdaCells) },
      { x: cx, y: cy - Math.round(lambdaCells) },
      // Endfire ±x at 1λ past the outer source
      { x: cx + half + Math.round(lambdaCells), y: cy },
      { x: cx - half - Math.round(lambdaCells), y: cy },
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
