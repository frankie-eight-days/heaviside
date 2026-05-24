import type { Scene } from '../types'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const differentialPair: Scene = {
  id: 'pcb-differential-pair',
  category: 'pcb',
  name: 'Differential pair',
  description:
    'Two parallel traces with FR-4 between them, driven 180° out of phase. The differential field stays locked between the traces — that\'s why diff pairs reject common-mode noise.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('pulse')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const tracePlusY = Math.floor(H * 0.45)
    const traceMinusY = tracePlusY + 40

    engine.paintRect(0, tracePlusY + 2, W, traceMinusY - 1, FR4)
    engine.paintRect(0, tracePlusY, W, tracePlusY + 1, PEC_BRUSH)
    engine.paintRect(0, traceMinusY - 1, W, traceMinusY, PEC_BRUSH)

    // Two single-cell sources just inside the gap, opposite phase. The
    // anti-symmetric drive cleanly excites the TM₁ "differential" mode
    // (sin profile across y).
    engine.setSources([
      { x: 20, y: tracePlusY + 4, phase: 0, amplitude: 1 },
      { x: 20, y: traceMinusY - 4, phase: Math.PI, amplitude: 1 },
    ])
    engine.firePulse()
    return { sourcePeriod: 80, sourceMode: 'pulse', viewMode: 'magnitude' }
  },
}
