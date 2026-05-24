import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush, portColumn } from '../helpers'

export const microstrip: Scene = {
  id: 'pcb-microstrip',
  category: 'pcb',
  name: 'Microstrip',
  description:
    'Signal trace over FR-4 over a ground plane. TEz quasi-TEM mode — vertical Ey between trace and ground, Hz circulating around the trace. Probe line along the gap reads VSWR; standing-wave min/max gives Γ.',
  polarization: 'TEz',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.45)
    const groundY = traceY + 30
    const midY = Math.floor((traceY + groundY) / 2)

    engine.paintRect(0, traceY + 2, W, groundY - 1, FR4)
    engine.paintRect(0, groundY, W, groundY + 2, PEC_BRUSH)
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    // Port column of Ey sources spans the substrate gap — drives the TEM
    // mode uniformly rather than exciting parallel-plate harmonics.
    engine.setSources(portColumn(20, traceY + 2, groundY - 1, 0, 1, 'y'))

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
