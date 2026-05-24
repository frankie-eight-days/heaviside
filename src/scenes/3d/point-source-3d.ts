import type { Scene } from '../types'
import type { FDTDEngine3D } from '../../gpu/fdtd'

export const pointSource3D: Scene = {
  id: '3d-point-source',
  category: '3d',
  name: 'Point source (smoke test)',
  description:
    'Centered Ez-polarized point source in a 128³ vacuum cube with CPML absorbing all six faces. Watch the XY midplane slice — concentric oscillations radiate outward and should fade into the boundary without visible reflection.',
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 60
    const engine3D = engine as FDTDEngine3D
    engine3D.resetFields()
    engine3D.setSourcePeriod(period)
    engine3D.setSourceMode('cw')

    const { width: W, height: H, depth: D } = engine3D.getDims3D()
    engine3D.setSources3D([
      {
        x: Math.floor(W / 2),
        y: Math.floor(H / 2),
        z: Math.floor(D / 2),
        phase: 0,
        amplitude: 1,
        polarization: 'z',
      },
    ])
    engine3D.setViewSlice('xy', Math.floor(D / 2))

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'ez',
      probes: [],
      polarization: '3D',
    }
  },
}
