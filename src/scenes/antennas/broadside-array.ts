import type { Scene } from '../types'
import { wavelengthCells } from '../helpers'

export const broadsideArray: Scene = {
  id: 'antenna-broadside-array',
  category: 'antennas',
  name: '2-element broadside array',
  description:
    'Two sources spaced λ/2 apart, driven in phase. Probes broadside (perpendicular to the array axis) read strong — that\'s the broadside peak. Endfire probes read weak.',
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
    const half = Math.floor(λ / 4)

    engine.setSources([
      { x: cx, y: cy - half, phase: 0, amplitude: 1 },
      { x: cx, y: cy + half, phase: 0, amplitude: 1 },
    ])

    // Array axis is vertical (sources stacked along y).
    // Broadside = horizontal (east, west) — should be strong.
    // Endfire = vertical (north, south) — should be weak (lobes cancel here).
    const r = Math.round(λ * 1.5)
    const probes = [
      { x: cx + r, y: cy },
      { x: cx - r, y: cy },
      { x: cx, y: cy - r },
      { x: cx, y: cy + r },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
