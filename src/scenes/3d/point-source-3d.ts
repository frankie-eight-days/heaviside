import type { Scene } from '../types'
import type { FDTDEngine3D } from '../../gpu/fdtd'

export const pointSource3D: Scene = {
  id: '3d-hertzian',
  category: '3d',
  name: 'Hertzian dipole',
  description:
    'A single point source — the infinitesimal antenna. Ez-polarized at the cube center, drives a spherical wave that decays as 1/r. XY slice shows the broadside ring (max in the plane perpendicular to the source). XZ / YZ slices show a clean rotationally-symmetric pattern.',
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 100
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
