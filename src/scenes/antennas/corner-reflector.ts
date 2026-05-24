import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

export const cornerReflector: Scene = {
  id: 'antenna-corner-reflector',
  category: 'antennas',
  name: 'Corner reflector',
  description:
    'Source inside an open box of three PEC walls. Magnitude view shows the directional beam exiting the open side.',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const λ = wavelengthCells(period)
    const cy = Math.floor(H / 2)
    const backX = Math.floor(W * 0.3)
    const halfH = Math.floor(λ * 0.9)
    const depth = Math.floor(λ * 0.9)

    engine.paintRect(backX, cy - halfH, backX + 2, cy + halfH, PEC_BRUSH)
    engine.paintRect(backX, cy - halfH, backX + depth, cy - halfH + 2, PEC_BRUSH)
    engine.paintRect(backX, cy + halfH - 2, backX + depth, cy + halfH, PEC_BRUSH)

    engine.setSources([
      { x: backX + Math.floor(λ / 4), y: cy, phase: 0, amplitude: 1 },
    ])
    return { sourcePeriod: period, sourceMode: 'cw', viewMode: 'magnitude' }
  },
}
