import type { Scene } from '../types'

export const hertzianDipole: Scene = {
  id: 'antenna-hertzian',
  category: 'antennas',
  name: 'Hertzian dipole',
  description:
    'A single point current source — the infinitesimal building block of every antenna. Magnitude view shows perfect circular radiation.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')
    engine.setSources([
      { x: Math.floor(W / 2), y: Math.floor(H / 2), phase: 0, amplitude: 1 },
    ])
    return { sourcePeriod: 80, sourceMode: 'cw', viewMode: 'magnitude' }
  },
}
