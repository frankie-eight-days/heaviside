import type { Scene } from '../types'
import { wavelengthCells } from '../helpers'

export const broadsideArray: Scene = {
  id: 'antenna-broadside-array',
  category: 'antennas',
  name: '2-element broadside array',
  description:
    'Two sources spaced λ/2 apart, driven in phase. Radiation peaks perpendicular to the array axis — the textbook broadside pattern.',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2)
    const half = Math.floor(wavelengthCells(period) / 4)

    engine.setSources([
      { x: cx, y: cy - half, phase: 0, amplitude: 1 },
      { x: cx, y: cy + half, phase: 0, amplitude: 1 },
    ])
    return { sourcePeriod: period, sourceMode: 'cw', viewMode: 'magnitude' }
  },
}
