import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush, portColumn } from '../helpers'

export const differentialPair: Scene = {
  id: 'pcb-differential-pair',
  category: 'pcb',
  name: 'Differential pair',
  description:
    'Two PEC traces with FR-4 between, no ground plane. The diff-mode TEM has Ey pointing between traces, Hz circulating around them. Port drives Ey across the full gap; probe line along the midline reads diff-mode VSWR.',
  polarization: 'TEz',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const tracePlusY = Math.floor(H * 0.45)
    const traceMinusY = tracePlusY + 30
    const midY = Math.floor((tracePlusY + traceMinusY) / 2)

    engine.paintRect(0, tracePlusY + 2, W, traceMinusY - 1, FR4)
    engine.paintRect(0, tracePlusY, W, tracePlusY + 1, PEC_BRUSH)
    engine.paintRect(0, traceMinusY - 1, W, traceMinusY, PEC_BRUSH)

    engine.setSources(portColumn(20, tracePlusY + 2, traceMinusY - 1, 0, 1, 'y'))

    const probes: ProbeSpec[] = []
    const xStart = 60
    const xEnd = W - 60
    const N = 8
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      probes.push({ x: Math.round(xStart + t * (xEnd - xStart)), y: midY })
    }

    return {
      sourcePeriod: 80,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
      polarization: 'TEz',
    }
  },
}
