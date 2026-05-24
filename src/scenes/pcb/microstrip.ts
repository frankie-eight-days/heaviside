import type { Scene } from '../types'
import type { ProbeSpec } from '../../gpu/fdtd'
import { PEC_BRUSH, materialBrush } from '../helpers'

export const microstrip: Scene = {
  id: 'pcb-microstrip',
  category: 'pcb',
  name: 'Microstrip (2D parallel-plate analog)',
  description:
    'Trace over FR-4 over a ground plane. Probe line along the gap reads VSWR. Note: this is the parallel-plate TM₁ mode, not the textbook microstrip TEM — that mode needs TEz or 3D. Pedagogy that transfers: wave slowing by √Dk, end reflections.',
  apply: (engine, { width: W, height: H }) => {
    engine.resetMaterials()
    engine.resetFields()
    engine.setSourcePeriod(80)
    engine.setSourceMode('cw')
    engine.setViewMode('magnitude')

    const FR4 = materialBrush(4.4, 0.02)
    const traceY = Math.floor(H * 0.45)
    const groundY = traceY + 50
    const midY = Math.floor((traceY + groundY) / 2)

    engine.paintRect(0, traceY + 2, W, groundY - 1, FR4)
    engine.paintRect(0, groundY, W, groundY + 2, PEC_BRUSH)
    engine.paintRect(0, traceY, W, traceY + 1, PEC_BRUSH)

    engine.setSources([{ x: 20, y: midY, phase: 0, amplitude: 1 }])

    // 8-probe line along the channel. Standing-wave max/min = VSWR.
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
