import type { Scene } from '../types'
import { PEC_BRUSH, paintParabola, wavelengthCells } from '../helpers'

export const parabolicReflector: Scene = {
  id: 'antenna-parabolic',
  category: 'antennas',
  name: 'Parabolic reflector',
  description:
    'Source at the focus of a parabolic PEC dish. Probes along the collimated beam axis show roughly constant amplitude — the rays are parallel, not spreading.',
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
    const focusX = vertexX + focalLength

    paintParabola(engine, vertexX, cy, focalLength, halfHeight, PEC_BRUSH)

    engine.setSources([{ x: focusX, y: cy, phase: 0, amplitude: 1 }])

    // P1–P3: along the collimated beam axis at 1λ, 3λ, 5λ ahead of the focus.
    // A parabolic reflector makes the beam roughly parallel, so amplitudes
    // along the beam fall MUCH slower than the 1/√r of a free source.
    // P4: off-axis at 5λ ahead, ~2λ above — should be weak (narrow beam).
    const probes = [
      { x: focusX + Math.round(λ * 1.0), y: cy },
      { x: focusX + Math.round(λ * 3.0), y: cy },
      { x: focusX + Math.round(λ * 5.0), y: cy },
      { x: focusX + Math.round(λ * 5.0), y: cy - Math.round(λ * 2.0) },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
