import type { Scene } from '../types'
import type { FDTDEngine3D, ProbeSpec } from '../../gpu/fdtd'

const SC_3D = 0.99 / Math.sqrt(3)
const PEC_BRUSH = { epsilonR: 1, sigma: 0, pec: true }

export const yagiUda3D: Scene = {
  id: '3d-yagi-uda',
  category: '3d',
  name: 'Yagi-Uda antenna',
  description:
    'Four vertical PEC elements stacked along x — reflector behind, driven dipole, two directors in front. Source at the driven feed gap; parasitic elements re-radiate with phase delays that constructively interfere forward. XZ slice opens to show the antenna structure (vertical bars) and the forward beam shooting +x. Compare to the 2D Yagi — now genuinely 3D-directional.',
  polarization: '3D',
  apply: (engine, _dims) => {
    const period = 100
    const engine3D = engine as FDTDEngine3D
    engine3D.resetMaterials()
    engine3D.resetFields()
    engine3D.setSourcePeriod(period)
    engine3D.setSourceMode('cw')

    const { width: W, height: H, depth: D } = engine3D.getDims3D()
    const cy = Math.floor(H / 2)
    const cz = Math.floor(D / 2)

    const lambdaCells = period * SC_3D
    const drivenHalf = Math.max(2, Math.floor(lambdaCells * 0.21))
    const reflectorHalf = drivenHalf + 1
    const directorHalf = Math.max(2, drivenHalf - 1)
    const gap = 2

    // Spacings 0.25λ (reflector) and 0.3λ (directors) — textbook Yagi.
    const reflectorSpacing = Math.floor(lambdaCells * 0.25)
    const directorSpacing = Math.floor(lambdaCells * 0.3)

    // Place the driven element left-of-center so the forward beam fills the canvas.
    const drivenX = Math.floor(W * 0.32)
    const reflectorX = drivenX - reflectorSpacing
    const director1X = drivenX + directorSpacing
    const director2X = director1X + directorSpacing

    // Reflector — solid PEC bar, no feed gap (parasitic).
    engine3D.paintBox3D(
      reflectorX - 1,
      cy - 1,
      cz - reflectorHalf,
      reflectorX + 1,
      cy + 1,
      cz + reflectorHalf,
      PEC_BRUSH,
    )

    // Driven element — two arms with feed gap.
    engine3D.paintBox3D(drivenX - 1, cy - 1, cz + gap + 1, drivenX + 1, cy + 1, cz + gap + drivenHalf, PEC_BRUSH)
    engine3D.paintBox3D(drivenX - 1, cy - 1, cz - gap - drivenHalf, drivenX + 1, cy + 1, cz - gap - 1, PEC_BRUSH)

    // Directors — solid PEC bars.
    engine3D.paintBox3D(
      director1X - 1,
      cy - 1,
      cz - directorHalf,
      director1X + 1,
      cy + 1,
      cz + directorHalf,
      PEC_BRUSH,
    )
    engine3D.paintBox3D(
      director2X - 1,
      cy - 1,
      cz - directorHalf,
      director2X + 1,
      cy + 1,
      cz + directorHalf,
      PEC_BRUSH,
    )

    engine3D.setSources3D([
      { x: drivenX, y: cy, z: cz, phase: 0, amplitude: 1, polarization: 'z' },
    ])

    const probes: ProbeSpec[] = [
      // Forward (in front of the directors) at 0.5λ and 1.5λ.
      { x: director2X + Math.round(lambdaCells * 0.5), y: cz },
      { x: director2X + Math.round(lambdaCells * 1.5), y: cz },
      // Back (behind the reflector).
      { x: reflectorX - Math.round(lambdaCells * 0.5), y: cz },
      // Sideways (broadside to the array axis — should be weakish for a tuned Yagi).
      { x: drivenX, y: cz + drivenHalf + Math.round(lambdaCells * 0.5) },
    ]

    return {
      sourcePeriod: period,
      sourceMode: 'cw',
      viewMode: 'magnitude',
      probes,
      polarization: '3D',
      sliceAxis: 'xz',
      sliceDepth: cy,
    }
  },
}
