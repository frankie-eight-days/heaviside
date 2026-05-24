import type { Scene } from '../types'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const stripline: Scene = {
  id: 'pcb-stripline',
  category: 'pcb',
  name: 'Stripline',
  description:
    'Trace embedded between two PEC planes inside FR-4. Magnitude view shows the wave packet trail fully confined — no fringing into air like microstrip has.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('pulse')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.5)
    const topY = traceY - 30
    const bottomY = traceY + 30
    const upperMidY = Math.floor((topY + traceY) / 2)

    // FR-4 fills the entire chamber between the planes.
    engine.paintRect(0, topY + 2, W, bottomY - 1, FR4)
    // Top ground plane.
    engine.paintRect(0, topY, W, topY + 2, PEC_BRUSH)
    // Bottom ground plane.
    engine.paintRect(0, bottomY - 1, W, bottomY, PEC_BRUSH)
    // Trace, centered between the planes.
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    // Drive the upper half-channel (between top plane and trace). Stripline
    // is symmetric, so a single half-drive excites a clean TM₁ mode.
    engine.setSources([{ x: 20, y: upperMidY, phase: 0, amplitude: 1 }])
    engine.firePulse()
    return { sourcePeriod: 80, sourceMode: 'pulse', viewMode: 'magnitude' }
  },
}
