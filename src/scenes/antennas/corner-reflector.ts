import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

export const cornerReflector: Scene = {
  id: 'antenna-corner-reflector',
  category: 'antennas',
  name: 'Corner reflector',
  description:
    'Source inside a 3-walled PEC box opening to the right. Forward probes read strong; probes behind / above the walls are in the shadow.',
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

    const sourceX = backX + Math.floor(λ / 4)
    engine.setSources([{ x: sourceX, y: cy, phase: 0, amplitude: 1 }])

    // P1, P2: forward of the opening at 1.5λ and 3λ — main beam.
    // P3: behind the back wall — shadowed.
    // P4: above the top wall — also shadowed (the box closes off this direction).
    const probes = [
      { x: backX + depth + Math.round(λ * 1.5), y: cy },
      { x: backX + depth + Math.round(λ * 3.0), y: cy },
      { x: backX - Math.round(λ * 0.8), y: cy },
      { x: sourceX, y: cy - halfH - Math.round(λ * 0.8) },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
