import type { Scene } from '../types'
import { PEC_BRUSH, paintParabola, wavelengthCells } from '../helpers'

export const parabolicReflector: Scene = {
  id: 'antenna-parabolic',
  category: 'antennas',
  name: 'Parabolic reflector',
  description:
    'Source at the focus of a parabolic PEC dish. Magnitude view shows the rays collimated into a beam.',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const λ = wavelengthCells(period)
    const cy = Math.floor(H / 2)
    const vertexX = Math.floor(W * 0.25)
    const focalLength = Math.floor(λ * 1.2)
    const halfHeight = Math.floor(λ * 2.0)

    paintParabola(engine, vertexX, cy, focalLength, halfHeight, PEC_BRUSH)

    engine.setSources([{ x: vertexX + focalLength, y: cy, phase: 0, amplitude: 1 }])
    return { sourcePeriod: period, sourceMode: 'cw', viewMode: 'magnitude' }
  },
}
