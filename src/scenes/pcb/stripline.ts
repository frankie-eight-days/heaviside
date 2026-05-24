import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const stripline: Scene = {
  id: 'pcb-stripline',
  category: 'pcb',
  name: 'Stripline (2D parallel-plate analog)',
  description:
    'Trace embedded between two PEC planes in FR-4 — field fully confined, no fringing into air. Same TMz caveat as microstrip: what propagates is the parallel-plate TM₁, not stripline TEM.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.5)
    const topY = traceY - 30
    const bottomY = traceY + 30
    const upperMidY = Math.floor((topY + traceY) / 2)

    engine.paintRect(0, topY + 2, W, bottomY - 1, FR4)
    engine.paintRect(0, topY, W, topY + 2, PEC_BRUSH)
    engine.paintRect(0, bottomY - 1, W, bottomY, PEC_BRUSH)
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    engine.setSources([{ x: 20, y: upperMidY, phase: 0, amplitude: 1 }])

    // Probe line in the upper half-channel (where the source drives).
    const probes: ProbeSpec[] = []
    const xStart = 60
    const xEnd = W - 60
    const N = 8
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      probes.push({ x: Math.round(xStart + t * (xEnd - xStart)), y: upperMidY })
    }

    return { sourcePeriod: 80, sourceMode: 'cw', viewMode: 'magnitude', probes }
  },
}
