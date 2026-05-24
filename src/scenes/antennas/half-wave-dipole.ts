import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

export const halfWaveDipole: Scene = {
  id: 'antenna-half-wave-dipole',
  category: 'antennas',
  name: 'λ/2 dipole',
  description:
    'Two PEC arms each λ/4 long with a feed gap at center. Broadside probes (E/W) read strong; endfire probes (N/S) read the null — that asymmetry IS the figure-8 pattern.',
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
    // Tip-to-tip ≈ 0.475λ for resonance. With a 2-cell gap on each side of
    // the source (5 cells of gap total), arm ≈ (0.475λ − 5) / 2 ≈ 0.21λ.
    const arm = Math.max(2, Math.floor(λ * 0.21))
    const gap = 2

    engine.paintRect(cx - 1, cy - gap - arm, cx + 1, cy - gap - 1, PEC_BRUSH)
    engine.paintRect(cx - 1, cy + gap + 1, cx + 1, cy + gap + arm, PEC_BRUSH)

    engine.setSources([{ x: cx, y: cy, phase: 0, amplitude: 1 }])

    // P1, P2: broadside (east, west) at 1.5λ — should be strong.
    // P3, P4: endfire (north, south) at 1.5λ — null direction, much weaker.
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
