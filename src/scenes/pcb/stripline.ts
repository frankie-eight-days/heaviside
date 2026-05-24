import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush, portColumn } from '../helpers'

export const stripline: Scene = {
  id: 'pcb-stripline',
  category: 'pcb',
  name: 'Stripline',
  description:
    'Signal trace embedded between two ground planes in FR-4. TEM mode fully confined — no fringing into air, no radiation. Port drives Ey in the upper half-channel; probes along the upper midline read VSWR.',
  polarization: 'TEz',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.5)
    const topY = traceY - 20
    const bottomY = traceY + 20
    const upperMidY = Math.floor((topY + traceY) / 2)

    engine.paintRect(0, topY + 2, W, bottomY - 1, FR4)
    engine.paintRect(0, topY, W, topY + 2, PEC_BRUSH)
    engine.paintRect(0, bottomY - 1, W, bottomY, PEC_BRUSH)
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    // Drive the upper half-channel — symmetric stripline supports identical
    // modes in upper and lower halves; one half is enough to demo.
    engine.setSources(portColumn(20, topY + 2, traceY - 1, 0, 1, 'y'))

    const probes: ProbeSpec[] = []
    const xStart = 60
    const xEnd = W - 60
    const N = 8
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      probes.push({ x: Math.round(xStart + t * (xEnd - xStart)), y: upperMidY })
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
