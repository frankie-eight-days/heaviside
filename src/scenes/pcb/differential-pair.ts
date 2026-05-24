import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const differentialPair: Scene = {
  id: 'pcb-differential-pair',
  category: 'pcb',
  name: 'Differential pair (2D analog)',
  description:
    'Two parallel traces driven 180° out of phase with FR-4 between. Antisymmetric parallel-plate mode propagates between them — differential field stays trapped. Probe line in the substrate reads VSWR.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const tracePlusY = Math.floor(H * 0.45)
    const traceMinusY = tracePlusY + 40
    const midY = Math.floor((tracePlusY + traceMinusY) / 2)

    engine.paintRect(0, tracePlusY + 2, W, traceMinusY - 1, FR4)
    engine.paintRect(0, tracePlusY, W, tracePlusY + 1, PEC_BRUSH)
    engine.paintRect(0, traceMinusY - 1, W, traceMinusY, PEC_BRUSH)

    const portX = 20
    engine.setSources([
      { x: portX, y: tracePlusY + 4, phase: 0, amplitude: 1 },
      { x: portX, y: traceMinusY - 4, phase: Math.PI, amplitude: 1 },
    ])

    // Probe line down the middle of the gap (where differential E is strongest).
    const probes: ProbeSpec[] = []
    const xStart = 60
    const xEnd = W - 60
    const N = 8
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      probes.push({ x: Math.round(xStart + t * (xEnd - xStart)), y: midY })
    }

    return { sourcePeriod: 80, sourceMode: 'cw', viewMode: 'magnitude', probes }
  },
}
