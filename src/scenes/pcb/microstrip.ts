import type { Scene } from '../types'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const microstrip: Scene = {
  id: 'pcb-microstrip',
  category: 'pcb',
  name: 'Microstrip line',
  description:
    "Trace above FR-4 above a ground plane (side view). The signal IS the field in the gap — watch the magnitude trail propagate between the strips. Above the trace is air, so some energy fringes upward.",
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('pulse')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.45)
    const groundY = traceY + 50
    const midY = Math.floor((traceY + groundY) / 2)

    // Substrate fills the gap between trace and ground.
    engine.paintRect(0, traceY + 2, W, groundY - 1, FR4)
    // Ground plane (3 cells thick).
    engine.paintRect(0, groundY, W, groundY + 2, PEC_BRUSH)
    // Trace (2 cells thick).
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    // Single source at the gap midpoint, just past the left PML. Excites the
    // parallel-plate TM₁ mode (the 2D analog of the microstrip TEM mode).
    engine.setSources([{ x: 20, y: midY, phase: 0, amplitude: 1 }])
    engine.firePulse()
    return { sourcePeriod: 80, sourceMode: 'pulse', viewMode: 'magnitude' }
  },
}
