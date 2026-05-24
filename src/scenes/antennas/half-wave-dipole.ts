import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

export const halfWaveDipole: Scene = {
  id: 'antenna-half-wave-dipole',
  category: 'antennas',
  name: 'λ/2 dipole',
  description:
    'Two PEC arms each λ/4 long with a feed gap at center. Magnitude shows the broadside (left/right) radiation lobes.',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)
    const arm = Math.floor(wavelengthCells(period) / 4)
    const gap = 2

    engine.paintRect(cx - 1, cy - gap - arm, cx + 1, cy - gap - 1, PEC_BRUSH)
    engine.paintRect(cx - 1, cy + gap + 1, cx + 1, cy + gap + arm, PEC_BRUSH)

    engine.setSources([{ x: cx, y: cy, phase: 0, amplitude: 1 }])
    return { sourcePeriod: period, sourceMode: 'cw', viewMode: 'magnitude' }
  },
}
