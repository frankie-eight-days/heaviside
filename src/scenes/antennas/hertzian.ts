import type { Scene } from '../types'
import { wavelengthCells } from '../helpers'

export const hertzianDipole: Scene = {
  id: 'antenna-hertzian',
  category: 'antennas',
  name: 'Hertzian dipole',
  description:
    'Single point source — the infinitesimal antenna. Probes along one axis show 1/√r amplitude falloff (the 2D cylindrical-wave signature).',
  polarization: 'TMz',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)
    const λ = wavelengthCells(period)

    engine.setSources([{ x: cx, y: cy, phase: 0, amplitude: 1 }])

    // 4 probes east of source at 0.5λ, 1.0λ, 1.5λ, 2.0λ. Peak amplitude
    // should drop as 1/√r — easy to read in the panel.
    const probes = [
      { x: cx + Math.round(λ * 0.5), y: cy },
      { x: cx + Math.round(λ * 1.0), y: cy },
      { x: cx + Math.round(λ * 1.5), y: cy },
      { x: cx + Math.round(λ * 2.0), y: cy },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
