import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

export const yagiUda: Scene = {
  id: 'antenna-yagi-uda',
  category: 'antennas',
  name: 'Yagi-Uda antenna',
  description:
    '4-element Yagi: reflector, driven dipole, two directors. Pre-placed probes show the front-to-back gain ratio in the panel.',
  polarization: 'TMz',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const λ = wavelengthCells(period)
    // Place the antenna left-of-center so the forward beam fills most of the canvas.
    const cx = Math.floor(W * 0.32)
    const cy = Math.floor(H / 2)

    // Resonant element lengths (tip-to-tip): driven ≈ 0.475λ, reflector ~5%
    // longer, directors ~5% shorter. At λ=57 cells integer rounding gives us
    // ±1 cell per arm — the best resolution available without bumping period.
    const drivenHalf = Math.max(2, Math.floor(λ * 0.21))
    const reflectorHalf = drivenHalf + 1
    const directorHalf = Math.max(2, drivenHalf - 1)
    const gap = 2

    // Spacings (textbook Yagi is tight: 0.15–0.35λ, NOT 0.5λ).
    const reflectorSpacing = Math.floor(λ * 0.25)
    const directorSpacing = Math.floor(λ * 0.3)

    const reflectorX = cx - reflectorSpacing
    const director1X = cx + directorSpacing
    const director2X = director1X + directorSpacing

    // Reflector (continuous PEC bar, no gap — parasitic).
    engine.paintRect(
      reflectorX - 1,
      cy - reflectorHalf,
      reflectorX + 1,
      cy + reflectorHalf,
      PEC_BRUSH,
    )

    // Driven dipole with feed gap.
    engine.paintRect(cx - 1, cy - gap - drivenHalf, cx + 1, cy - gap - 1, PEC_BRUSH)
    engine.paintRect(cx - 1, cy + gap + 1, cx + 1, cy + gap + drivenHalf, PEC_BRUSH)

    // Directors (parasitic, no gap).
    engine.paintRect(
      director1X - 1,
      cy - directorHalf,
      director1X + 1,
      cy + directorHalf,
      PEC_BRUSH,
    )
    engine.paintRect(
      director2X - 1,
      cy - directorHalf,
      director2X + 1,
      cy + directorHalf,
      PEC_BRUSH,
    )

    engine.setSources([{ x: cx, y: cy, phase: 0, amplitude: 1 }])

    // Pre-placed probes: forward beam (P1–P4) + back lobe (P5–P6) at half-λ
    // spacing so the user can read phase progression along the beam.
    const probes = [
      { x: director2X + Math.round(λ * 0.5), y: cy },
      { x: director2X + Math.round(λ * 1.0), y: cy },
      { x: director2X + Math.round(λ * 1.5), y: cy },
      { x: director2X + Math.round(λ * 2.0), y: cy },
      { x: reflectorX - Math.round(λ * 0.5), y: cy },
      { x: reflectorX - Math.round(λ * 1.0), y: cy },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
