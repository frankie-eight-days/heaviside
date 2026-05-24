import type { Scene } from '../types'
import { PEC_BRUSH, wavelengthCells } from '../helpers'

// Receive-dipole geometry: vertical PEC bar with a small feed gap. Purely
// passive — driven only by the incoming wave from the TX antenna.
function paintRxDipole(
  engine: import('../../gpu/fdtd').FDTDEngine,
  x: number,
  y: number,
  armLen: number,
  gap: number,
) {
  engine.paintRect(x - 1, y - gap - armLen, x + 1, y - gap - 1, PEC_BRUSH)
  engine.paintRect(x - 1, y + gap + 1, x + 1, y + gap + armLen, PEC_BRUSH)
}

export const txRxLink: Scene = {
  id: 'antenna-tx-rx-link',
  category: 'antennas',
  name: 'TX → RX link (directivity demo)',
  description:
    'Yagi transmitter on the left, three passive RX dipoles on the right (on-axis + two off-axis). Probes at each feed gap show how much voltage the RX picks up. On-axis RX gets the full beam; off-axis RX dipoles get the side-lobe scraps.',
  apply: (engine, { width: W, height: H }) => {
    const period = 80
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(period)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const λ = wavelengthCells(period)
    const cy = Math.floor(H / 2)

    // --- TX Yagi (4 elements) ---
    const txCx = Math.floor(W * 0.18)
    const drivenHalf = Math.floor(λ * 0.25)
    const reflectorHalf = Math.floor(λ * 0.275)
    const directorHalf = Math.floor(λ * 0.2)
    const gap = 2
    const reflectorSpacing = Math.floor(λ * 0.25)
    const directorSpacing = Math.floor(λ * 0.3)

    const reflectorX = txCx - reflectorSpacing
    const director1X = txCx + directorSpacing
    const director2X = director1X + directorSpacing

    engine.paintRect(
      reflectorX - 1,
      cy - reflectorHalf,
      reflectorX + 1,
      cy + reflectorHalf,
      PEC_BRUSH,
    )
    engine.paintRect(txCx - 1, cy - gap - drivenHalf, txCx + 1, cy - gap - 1, PEC_BRUSH)
    engine.paintRect(txCx - 1, cy + gap + 1, txCx + 1, cy + gap + drivenHalf, PEC_BRUSH)
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

    engine.setSources([{ x: txCx, y: cy, phase: 0, amplitude: 1 }])

    // --- RX dipoles (passive, λ/2 each) ---
    const rxX = Math.floor(W * 0.75)
    const rxArm = drivenHalf
    const offAxis = Math.round(λ * 4)
    paintRxDipole(engine, rxX, cy, rxArm, gap) // on-axis
    paintRxDipole(engine, rxX, cy - offAxis, rxArm, gap) // above
    paintRxDipole(engine, rxX, cy + offAxis, rxArm, gap) // below

    const probes = [
      { x: txCx, y: cy }, // P1: TX feed (reference)
      { x: rxX, y: cy }, // P2: on-axis RX feed
      { x: rxX, y: cy - offAxis }, // P3: above off-axis RX
      { x: rxX, y: cy + offAxis }, // P4: below off-axis RX
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
    }
  },
}
